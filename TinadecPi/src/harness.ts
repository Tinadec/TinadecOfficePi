import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { CoreStore, PiAgentExecution, PiToolExecution } from "./store.js";

type Chunk = Record<string, unknown>;
type LiveSession = { session: AgentSession; cwd: string };
type ModelInfo = {
	provider?: string;
	id?: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
};

export type PiRunMode =
	| "space"
	| "plan"
	| "spec"
	| "ask"
	| "vibe"
	| "auto"
	| "agent"
	| "pair";
type PairDelegation = {
	invoked: boolean;
	toolCallIds: Set<string>;
	requestedAgents: Set<string>;
	completedAgents: Set<string>;
	toolAgents: Map<string, string[]>;
};
export interface PiRunAgentConfig {
	id: string;
	name: string;
	layer: "operation" | "execution";
	agentType: string;
	runtimeAgent: string;
	mode: "default" | "parallel";
	allowedTools: string[];
	systemPrompt?: string;
	model?: { provider: string; id: string };
}
export interface PiRunConfig {
	agentProfileId: string;
	configVersion: number;
	initialContextRevision: number;
	systemPrompt?: string;
	fixedModel?: { provider: string; id: string };
	allowedTools?: string[];
	agents?: PiRunAgentConfig[];
}

type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

const require = createRequire(import.meta.url);
export function resolveAgentDir(
	configured = process.env.TINADEC_PI_AGENT_DIR,
	cwd = process.cwd(),
): string {
	return configured ?? join(cwd, ".tinadec-pi", "pi-agent");
}

export function resolveIsolatedTempDir(
	configuredAgentDir = resolveAgentDir(),
): string {
	return join(configuredAgentDir, "tmp");
}

export function isIsolatedSessionFile(
	sessionFile: string | null | undefined,
	configuredAgentDir = resolveAgentDir(),
): sessionFile is string {
	if (!sessionFile) return false;
	const sessionsDir = resolve(configuredAgentDir, "sessions");
	const candidate = resolve(sessionFile);
	const fromSessionsDir = relative(sessionsDir, candidate);
	return (
		Boolean(fromSessionsDir) &&
		!fromSessionsDir.startsWith("..") &&
		!isAbsolute(fromSessionsDir)
	);
}

const agentDir = resolveAgentDir();
const isolatedTmpDir = resolveIsolatedTempDir(agentDir);
// pi-subagents resolves its agent directory and temporary artifacts independently.
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.TEMP = isolatedTmpDir;
process.env.TMP = isolatedTmpDir;
const subagentsExtension = require.resolve("pi-subagents");
const observationalMemoryExtension = require.resolve(
	"pi-observational-memory/src/index.ts",
);

export class PiHarness {
	private readonly live = new Map<string, LiveSession>();
	private readonly invocationTails = new Map<string, Promise<void>>();
	private readonly activeRuns = new Map<string, string>();
	private readonly abortedRuns = new Set<string>();
	private modelRuntime = this.createModelRuntime();

	constructor(private readonly store: CoreStore) {}

	private createModelRuntime() {
		return ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
		});
	}

	async invoke(
		sessionId: string,
		content: string,
		onChunk?: (chunk: Chunk) => void,
		mode: PiRunMode = "auto",
		userMessageId?: string,
		config: PiRunConfig = defaultRunConfig(mode),
	): Promise<{ run_id: string; content: string }> {
		return this.enqueue(sessionId, () =>
			this.invokeOne(sessionId, content, onChunk, mode, userMessageId, config),
		);
	}

	private async invokeOne(
		sessionId: string,
		content: string,
		onChunk: ((chunk: Chunk) => void) | undefined,
		mode: PiRunMode,
		userMessageId: string | undefined,
		config: PiRunConfig,
	): Promise<{ run_id: string; content: string }> {
		if (mode === "space")
			await this.writeConfiguredAgentFiles(config.agents ?? []);
		const live = await this.open(sessionId);
		if (config.allowedTools) {
			const available = new Set(
				live.session.getAllTools().map((tool) => tool.name),
			);
			live.session.setActiveToolsByName(
				[...new Set([...config.allowedTools, "recall"])].filter((tool) =>
					available.has(tool),
				),
			);
		}
		if (config.fixedModel) {
			const fixedModel = (await this.modelRuntime).getModel(
				config.fixedModel.provider,
				config.fixedModel.id,
			);
			if (!fixedModel) throw new Error("Configured agent model was not found.");
			await live.session.setModel(fixedModel);
		}
		const run = await this.store.createRun(sessionId, mode, runSummary(mode), {
			userMessageId,
			agentProfileId: config.agentProfileId,
			configVersion: config.configVersion,
			initialContextRevision: config.initialContextRevision,
		});
		const pairDelegation: PairDelegation = {
			invoked: false,
			toolCallIds: new Set(),
			requestedAgents: new Set(),
			completedAgents: new Set(),
			toolAgents: new Map(),
		};
		let eventTail = Promise.resolve();

		this.activeRuns.set(sessionId, run.id);
		await this.store.updateSession(sessionId, { status: "running" });
		await this.store.publish(
			"run.started",
			sessionId,
			{
				run_id: run.id,
				id: run.id,
				mode,
				summary: run.summary,
				agent_profile_id: run.agent_profile_id,
				config_version: run.config_version,
				initial_context_revision: run.initial_context_revision,
				status: run.status,
			},
			["pi.agent"],
		);
		if (mode === "pair") {
			await this.createPairAgents(run.id, sessionId, content);
		} else if (mode === "space") {
			await this.createConfiguredAgents(
				run.id,
				sessionId,
				content,
				config.agents ?? [],
			);
		}
		onChunk?.(
			chunk(run.id, sessionId, "run_started", {
				mode,
				agent_profile_id: config.agentProfileId,
				config_version: config.configVersion,
			}),
		);

		const unsubscribe = live.session.subscribe((event) => {
			if (event.type === "message_update") {
				const update = event.assistantMessageEvent;
				if (update.type === "text_delta") {
					onChunk?.(
						chunk(run.id, sessionId, "delta", {
							delta: update.delta,
						}),
					);
				} else if (update.type === "thinking_delta") {
					onChunk?.(
						chunk(run.id, sessionId, "thinking_delta", {
							delta: update.delta,
						}),
					);
				}
			}
			eventTail = eventTail
				.then(() =>
					this.projectEvent(
						run.id,
						sessionId,
						event,
						onChunk,
						mode,
						pairDelegation,
					),
				)
				.catch(() => undefined);
		});

		try {
			const messageCount = live.session.messages.length;
			await live.session.prompt(
				promptForMode(content, mode, config.systemPrompt),
			);
			await eventTail;
			if (mode === "pair" && !pairDelegation.invoked) {
				throw new Error("Pi did not start the requested paired delegation.");
			}
			if (mode === "space") {
				const required = (config.agents ?? [])
					.filter((agent) =>
						["task_planner", "worker_pool", "supervisor"].includes(
							agent.agentType,
						),
					)
					.map((agent) => agent.runtimeAgent);
				// ponytail: only successful execution ends count; start/management lookups do not.
				if (
					!required.every((agent) => pairDelegation.completedAgents.has(agent))
				) {
					throw new Error(
						"space.full_duplex did not run its configured planner, worker, and supervisor roles.",
					);
				}
			}
			const result = lastAssistantResult(
				live.session.messages.slice(messageCount),
			);
			if (!result.content) {
				throw new Error(
					result.error ?? "Pi did not return an assistant response.",
				);
			}
			const output = result.content;
			const message = await this.store.addMessage(
				sessionId,
				"assistant",
				output,
				run.id,
			);
			if (mode === "plan" || mode === "spec") {
				const artifact = await this.writeArtifact(
					run.id,
					sessionId,
					mode,
					output,
				);
				await this.store.publish(
					"pi.artifact.created",
					sessionId,
					{
						run_id: run.id,
						artifact_id: artifact.id,
						kind: artifact.kind,
						title: artifact.title,
					},
					["pi.artifact"],
				);
				onChunk?.(
					chunk(run.id, sessionId, "artifact_created", {
						artifact_id: artifact.id,
						artifact_kind: artifact.kind,
						title: artifact.title,
					}),
				);
			}
			await this.completeConfiguredAgents(
				run.id,
				"completed",
				pairDelegation.requestedAgents,
			);
			await this.store.updateRun(run.id, {
				status: "completed",
				assistant_message_id: message.id,
			});
			await this.store.updateSession(sessionId, { status: "idle" });
			await this.store.publish(
				"message.created",
				sessionId,
				{ id: message.id, role: "assistant", run_id: run.id },
				["pi.agent"],
			);
			await this.store.publish(
				"run.completed",
				sessionId,
				{ run_id: run.id, id: run.id, status: "completed" },
				["pi.agent"],
			);
			onChunk?.(chunk(run.id, sessionId, "done", { finish_reason: "stop" }));
			return { run_id: run.id, content: output };
		} catch (error) {
			await eventTail;
			const message = error instanceof Error ? error.message : String(error);
			const cancelled = this.abortedRuns.has(run.id);
			const status = cancelled ? "cancelled" : "failed";
			await this.completeConfiguredAgents(
				run.id,
				cancelled ? "skipped" : "failed",
				pairDelegation.requestedAgents,
			);
			await this.store.updateRun(run.id, { status, error: message });
			await this.store.updateSession(sessionId, {
				status: cancelled ? "idle" : "failed",
			});
			await this.store.publish(
				cancelled ? "run.cancelled" : "run.failed",
				sessionId,
				{ run_id: run.id, id: run.id, status, message },
				["pi.agent"],
			);
			onChunk?.(
				chunk(run.id, sessionId, "error", {
					safe_error_message: message,
					finish_reason: cancelled ? "cancelled" : "error",
				}),
			);
			throw error;
		} finally {
			unsubscribe();
			this.activeRuns.delete(sessionId);
			this.abortedRuns.delete(run.id);
		}
	}

	private async writeConfiguredAgentFiles(
		agents: PiRunAgentConfig[],
	): Promise<void> {
		const directory = join(agentDir, "agents");
		await mkdir(directory, { recursive: true });
		for (const agent of agents) {
			if (agent.runtimeAgent === "parent") continue;
			// Literal inherit bypasses subagents.defaultModel and uses parent ctx.model.
			const model = agent.model
				? `\nmodel: ${agent.model.provider}/${agent.model.id}`
				: "\nmodel: inherit";
			const acceptanceRole =
				agent.layer === "execution" && agent.agentType === "worker_pool"
					? "writer"
					: "read-only";
			const defaultContext =
				agent.agentType === "worker_pool" ? "fork" : "fresh";
			const prompt = agent.systemPrompt?.trim() || defaultAgentPrompt(agent);
			const definition = [
				"---",
				`name: ${agent.runtimeAgent}`,
				`description: TinadecPi ${agent.name} role for a frozen run configuration`,
				`tools: ${agent.allowedTools.join(", ")}`,
				`systemPromptMode: replace`,
				`inheritProjectContext: true`,
				`inheritSkills: false`,
				`defaultContext: ${defaultContext}`,
				`acceptanceRole: ${acceptanceRole}${model}`,
				"---",
				"",
				prompt,
				"",
			].join("\n");
			await writeFile(
				join(directory, `${agent.runtimeAgent}.md`),
				definition,
				"utf8",
			);
		}
	}

	private async writeArtifact(
		runId: string,
		sessionId: string,
		kind: "plan" | "spec",
		content: string,
	) {
		const directory = join(agentDir, "artifacts", runId);
		const filename = kind === "plan" ? "plan.md" : "spec.md";
		const title = kind === "plan" ? "Implementation plan" : "Specification";
		const path = join(directory, filename);
		await mkdir(directory, { recursive: true });
		await writeFile(path, `# ${title}\n\n${content.trim()}\n`, "utf8");
		return this.store.createArtifact({
			run_id: runId,
			session_id: sessionId,
			kind,
			title,
			path,
		});
	}

	private async projectEvent(
		runId: string,
		sessionId: string,
		event: AgentSessionEvent,
		onChunk: ((chunk: Chunk) => void) | undefined,
		mode: PiRunMode,
		pairDelegation: PairDelegation,
	): Promise<void> {
		switch (event.type) {
			case "tool_execution_start":
				await this.startTool(
					runId,
					sessionId,
					event,
					onChunk,
					mode,
					pairDelegation,
				);
				return;
			case "tool_execution_update":
				await this.updateTool(runId, sessionId, event, onChunk);
				return;
			case "tool_execution_end":
				await this.finishTool(runId, sessionId, event, onChunk, pairDelegation);
				return;
			case "turn_start":
				await this.store.publish(
					"pi.turn.started",
					sessionId,
					{ run_id: runId },
					["pi.agent"],
				);
				return;
			case "turn_end":
				await this.store.publish(
					"pi.turn.completed",
					sessionId,
					{ run_id: runId },
					["pi.agent"],
				);
				return;
			case "queue_update":
				await this.store.publish(
					"pi.queue.updated",
					sessionId,
					{
						run_id: runId,
						steering_count: event.steering.length,
						follow_up_count: event.followUp.length,
					},
					["pi.agent"],
				);
				return;
			case "compaction_start":
				await this.store.publish(
					"pi.compaction.started",
					sessionId,
					{ run_id: runId, reason: event.reason },
					["pi.agent"],
				);
				return;
			case "compaction_end":
				await this.store.publish(
					"pi.compaction.completed",
					sessionId,
					{
						run_id: runId,
						reason: event.reason,
						aborted: event.aborted,
						error: event.errorMessage ?? null,
					},
					["pi.agent"],
				);
				return;
			case "auto_retry_start":
				await this.store.publish(
					"pi.retry.started",
					sessionId,
					{
						run_id: runId,
						attempt: event.attempt,
						max_attempts: event.maxAttempts,
						delay_ms: event.delayMs,
					},
					["pi.agent"],
				);
				return;
			case "auto_retry_end":
				await this.store.publish(
					"pi.retry.completed",
					sessionId,
					{
						run_id: runId,
						attempt: event.attempt,
						success: event.success,
						error: event.finalError ?? null,
					},
					["pi.agent"],
				);
				return;
			default:
				return;
		}
	}

	private async startTool(
		runId: string,
		sessionId: string,
		event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>,
		onChunk: ((chunk: Chunk) => void) | undefined,
		mode: PiRunMode,
		pairDelegation: PairDelegation,
	): Promise<void> {
		const timestamp = new Date().toISOString();
		const execution: PiToolExecution = {
			id: event.toolCallId,
			run_id: runId,
			session_id: sessionId,
			tool_id: event.toolName,
			tool_display_name: event.toolName,
			source: "pi",
			provider_layer: "pi-agent-sdk",
			risk: "unknown",
			requires_approval: false,
			status: "running",
			summary: summarize(event.args),
			evidence: [],
			requested_at: timestamp,
			updated_at: timestamp,
			duration_ms: 0,
			requested_seq: 0,
			updated_seq: 0,
			event_types: ["tool_execution_start"],
			checkpoint_summary: "Running",
		};
		await this.store.upsertToolExecution(execution);
		const published = await this.store.publish(
			"pi.tool.started",
			sessionId,
			{
				run_id: runId,
				tool_call_id: event.toolCallId,
				tool_id: event.toolName,
				summary: execution.summary,
				status: execution.status,
			},
			["pi.agent", "pi.tool"],
		);
		execution.requested_seq = published.seq;
		execution.updated_seq = published.seq;
		await this.store.upsertToolExecution(execution);
		onChunk?.(
			chunk(runId, sessionId, "tool_call_delta", {
				tool_call_delta: {
					call_id: event.toolCallId,
					tool_id: event.toolName,
					arguments: event.args as Record<string, unknown>,
				},
			}),
		);

		if (event.toolName !== "subagent" || !isSubagentExecution(event.args))
			return;
		const requestedAgents = subagentNames(event.args);
		for (const agent of requestedAgents)
			pairDelegation.requestedAgents.add(agent);
		if (
			(mode === "pair" &&
				requestedAgents.includes("scout") &&
				requestedAgents.includes("reviewer")) ||
			(mode === "space" &&
				requestedAgents.some((agent) => agent.startsWith("tinadec-")))
		) {
			pairDelegation.invoked = true;
			pairDelegation.toolCallIds.add(event.toolCallId);
			pairDelegation.toolAgents.set(event.toolCallId, requestedAgents);
			await this.updatePairAgents(runId, "running", event.args);
		}
	}

	private async updateTool(
		runId: string,
		sessionId: string,
		event: Extract<AgentSessionEvent, { type: "tool_execution_update" }>,
		onChunk: ((chunk: Chunk) => void) | undefined,
	): Promise<void> {
		const execution = this.store.getToolExecution(event.toolCallId);
		if (!execution) return;
		execution.summary = summarize(event.partialResult);
		execution.updated_at = new Date().toISOString();
		execution.event_types = [...execution.event_types, "tool_execution_update"];
		await this.store.upsertToolExecution(execution);
		const published = await this.store.publish(
			"pi.tool.updated",
			sessionId,
			{
				run_id: runId,
				tool_call_id: event.toolCallId,
				tool_id: event.toolName,
				summary: execution.summary,
				status: execution.status,
			},
			["pi.agent", "pi.tool"],
		);
		execution.updated_seq = published.seq;
		await this.store.upsertToolExecution(execution);
		onChunk?.(
			chunk(runId, sessionId, "tool_execution", {
				tool_call_id: event.toolCallId,
				tool_id: event.toolName,
				status: execution.status,
				summary: execution.summary,
			}),
		);
	}

	private async finishTool(
		runId: string,
		sessionId: string,
		event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>,
		onChunk: ((chunk: Chunk) => void) | undefined,
		pairDelegation: PairDelegation,
	): Promise<void> {
		const execution = this.store.getToolExecution(event.toolCallId);
		if (!execution) return;
		execution.status = event.isError ? "failed" : "completed";
		execution.summary = summarize(event.result);
		execution.evidence = compactEvidence(event.result);
		execution.updated_at = new Date().toISOString();
		execution.duration_ms = Math.max(
			0,
			Date.parse(execution.updated_at) - Date.parse(execution.requested_at),
		);
		execution.event_types = [...execution.event_types, "tool_execution_end"];
		execution.checkpoint_summary = event.isError ? "Failed" : "Completed";
		await this.store.upsertToolExecution(execution);
		const published = await this.store.publish(
			"pi.tool.completed",
			sessionId,
			{
				run_id: runId,
				tool_call_id: event.toolCallId,
				tool_id: event.toolName,
				summary: execution.summary,
				status: execution.status,
			},
			["pi.agent", "pi.tool"],
		);
		execution.updated_seq = published.seq;
		await this.store.upsertToolExecution(execution);
		if (pairDelegation.toolCallIds.has(event.toolCallId)) {
			if (!event.isError) {
				for (const agent of pairDelegation.toolAgents.get(event.toolCallId) ??
					[]) {
					pairDelegation.completedAgents.add(agent);
				}
			}
			await this.updatePairAgents(
				runId,
				event.isError ? "failed" : "completed",
				event.result,
			);
		}
		onChunk?.(
			chunk(runId, sessionId, "tool_execution", {
				tool_call_id: event.toolCallId,
				tool_id: event.toolName,
				status: execution.status,
				summary: execution.summary,
				duration_ms: execution.duration_ms,
			}),
		);
	}

	private async createConfiguredAgents(
		runId: string,
		sessionId: string,
		content: string,
		agents: PiRunAgentConfig[],
	): Promise<void> {
		for (const config of agents) {
			const timestamp = new Date().toISOString();
			const parent = config.runtimeAgent === "parent";
			const agent: PiAgentExecution = {
				id: `${runId}:${config.id}`,
				run_id: runId,
				session_id: sessionId,
				agent_id: config.id,
				agent_name: config.name,
				agent_type: config.agentType,
				agent_layer: config.layer,
				runtime_agent: config.runtimeAgent,
				direct_user_output: parent,
				status: parent ? "running" : "pending",
				task: truncate(content, 240),
				created_at: timestamp,
				updated_at: timestamp,
			};
			await this.store.upsertAgentExecution(agent);
			await this.store.publish(
				parent ? "pi.agent.running" : "pi.agent.pending",
				sessionId,
				{
					run_id: runId,
					agent_id: agent.agent_id,
					agent_name: agent.agent_name,
					agent_type: agent.agent_type,
					agent_layer: agent.agent_layer,
					runtime_agent: agent.runtime_agent,
					status: agent.status,
					task: agent.task,
				},
				["pi.subagent"],
			);
		}
	}

	private async completeConfiguredAgents(
		runId: string,
		status: PiAgentExecution["status"],
		requestedAgents: Set<string>,
	): Promise<void> {
		for (const agent of this.store.listAgentExecutions(runId)) {
			if (["completed", "failed", "skipped"].includes(agent.status)) continue;
			const ran =
				agent.runtime_agent === "parent" ||
				requestedAgents.has(String(agent.runtime_agent ?? agent.agent_type));
			const finalStatus = ran ? status : "skipped";
			const updated = {
				...agent,
				status: finalStatus,
				updated_at: new Date().toISOString(),
			};
			await this.store.upsertAgentExecution(updated);
			await this.store.publish(
				`pi.agent.${finalStatus}`,
				agent.session_id,
				{
					run_id: runId,
					agent_id: updated.agent_id,
					agent_name: updated.agent_name,
					agent_type: updated.agent_type,
					agent_layer: updated.agent_layer,
					runtime_agent: updated.runtime_agent,
					status: finalStatus,
					task: updated.task,
				},
				["pi.subagent"],
			);
		}
	}

	private async createPairAgents(
		runId: string,
		sessionId: string,
		content: string,
	): Promise<void> {
		for (const [agentType, task] of [
			["scout", content],
			["reviewer", content],
		] as const) {
			const timestamp = new Date().toISOString();
			const agent: PiAgentExecution = {
				id: `${runId}:${agentType}`,
				run_id: runId,
				session_id: sessionId,
				agent_id: agentType,
				agent_name: agentType,
				agent_type: agentType,
				status: "pending",
				task: truncate(task, 240),
				created_at: timestamp,
				updated_at: timestamp,
			};
			await this.store.upsertAgentExecution(agent);
		}
	}

	private async updatePairAgents(
		runId: string,
		status: PiAgentExecution["status"],
		value: unknown,
	): Promise<void> {
		const agents = this.store.listAgentExecutions(runId);
		const requested = subagentNames(value);
		for (const agent of agents) {
			if (
				requested.length > 0 &&
				!requested.includes(agent.agent_type) &&
				!requested.includes(String(agent.runtime_agent ?? ""))
			)
				continue;
			const updated = {
				...agent,
				status,
				updated_at: new Date().toISOString(),
			};
			await this.store.upsertAgentExecution(updated);
			await this.store.publish(
				`pi.agent.${status}`,
				agent.session_id,
				{
					run_id: runId,
					agent_id: updated.agent_id,
					agent_name: updated.agent_name,
					agent_type: updated.agent_type,
					agent_layer: updated.agent_layer,
					runtime_agent: updated.runtime_agent,
					status,
					task: updated.task,
				},
				["pi.subagent"],
			);
		}
	}

	private async enqueue<T>(
		sessionId: string,
		work: () => Promise<T>,
	): Promise<T> {
		const previous = this.invocationTails.get(sessionId) ?? Promise.resolve();
		let release!: () => void;
		const completion = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => completion);
		this.invocationTails.set(sessionId, tail);
		await previous;
		try {
			return await work();
		} finally {
			release();
			if (this.invocationTails.get(sessionId) === tail) {
				this.invocationTails.delete(sessionId);
			}
		}
	}

	async steer(sessionId: string, content: string): Promise<void> {
		await (await this.open(sessionId)).session.steer(content);
	}

	async followUp(sessionId: string, content: string): Promise<void> {
		await (await this.open(sessionId)).session.followUp(content);
	}

	async abort(sessionId: string): Promise<{ run_id?: string }> {
		const runId = this.activeRuns.get(sessionId);
		if (runId) {
			this.abortedRuns.add(runId);
			await this.store.publish(
				"run.cancel.requested",
				sessionId,
				{ run_id: runId },
				["pi.agent"],
			);
		}
		await (await this.open(sessionId)).session.abort();
		return runId ? { run_id: runId } : {};
	}

	async state(sessionId: string): Promise<Record<string, unknown>> {
		const session = (await this.open(sessionId)).session;
		const activeRun = this.store
			.listRuns(sessionId)
			.find((run) => run.status === "running");
		return {
			session_id: session.sessionId,
			session_file: session.sessionFile ?? null,
			model: modelInfo(session.model),
			thinking_level: session.thinkingLevel,
			thinking_levels: session.getAvailableThinkingLevels(),
			is_streaming: session.isStreaming,
			message_count: session.messages.length,
			active_run_id: activeRun?.id ?? null,
			active_tools: session.agent.state.tools.map((tool) => tool.name),
			agent_dir: process.env.TINADEC_PI_AGENT_DIR ? "configured" : "isolated",
			multi_agent: session.agent.state.tools.some(
				(tool) => tool.name === "subagent",
			),
			observational_memory: session.agent.state.tools.some(
				(tool) => tool.name === "recall",
			),
		};
	}

	async availableModels(): Promise<ModelInfo[]> {
		const runtime = await this.modelRuntime;
		const models = new Map<string, ModelInfo>();
		for (const model of await runtime.getAvailable()) {
			const info = modelInfo(model);
			// Case-fold so GPT-5.6-terra and gpt-5.6-terra collapse to one option.
			if (info) models.set(`${info.provider}/${info.id}`.toLowerCase(), info);
		}
		return [...models.values()];
	}

	async reloadModels(): Promise<ModelInfo[]> {
		if (this.activeRuns.size > 0) {
			throw new Error("Cannot refresh Pi models while a run is active.");
		}
		this.live.clear();
		this.modelRuntime = this.createModelRuntime();
		return this.availableModels();
	}

	async setModel(
		sessionId: string,
		provider: string,
		modelId: string,
	): Promise<ModelInfo | null> {
		const runtime = await this.modelRuntime;
		const model = runtime.getModel(provider, modelId);
		if (!model) throw new Error("Configured Pi model was not found.");
		const live = await this.open(sessionId);
		await live.session.setModel(model);
		const selected = modelInfo(live.session.model);
		await this.store.publish(
			"pi.model.selected",
			sessionId,
			{ provider, id: modelId, model: selected },
			["pi.model"],
		);
		return selected;
	}

	async thinkingLevels(sessionId: string): Promise<ThinkingLevel[]> {
		const live = await this.open(sessionId);
		return live.session.getAvailableThinkingLevels() as ThinkingLevel[];
	}

	async setThinkingLevel(
		sessionId: string,
		level: ThinkingLevel,
	): Promise<ThinkingLevel> {
		const live = await this.open(sessionId);
		live.session.setThinkingLevel(level);
		await this.store.publish(
			"pi.thinking.selected",
			sessionId,
			{ level: live.session.thinkingLevel },
			["pi.thinking"],
		);
		return live.session.thinkingLevel as ThinkingLevel;
	}

	private async open(sessionId: string): Promise<LiveSession> {
		const cached = this.live.get(sessionId);
		if (cached) return cached;

		const record = this.store.getSession(sessionId);
		if (!record) throw new Error("Session was not found.");
		const project = this.store.getProject(record.project_id);
		if (!project) throw new Error("Project was not found.");

		await mkdir(isolatedTmpDir, { recursive: true });
		const loader = new DefaultResourceLoader({
			cwd: project.path,
			agentDir,
			additionalExtensionPaths: [
				subagentsExtension,
				observationalMemoryExtension,
			],
		});
		await loader.reload();

		const result = await createAgentSession({
			cwd: project.path,
			agentDir,
			modelRuntime: await this.modelRuntime,
			resourceLoader: loader,
			sessionManager: isIsolatedSessionFile(record.pi_session_file)
				? SessionManager.open(record.pi_session_file)
				: SessionManager.create(project.path),
		});
		const live = { session: result.session, cwd: project.path };
		this.live.set(sessionId, live);
		if (
			result.session.sessionFile &&
			result.session.sessionFile !== record.pi_session_file
		) {
			await this.store.updateSession(sessionId, {
				pi_session_file: result.session.sessionFile,
			});
		}
		return live;
	}
}

function runSummary(mode: PiRunMode): string {
	return {
		space: "Full-duplex workspace run",
		plan: "Pi planning run",
		spec: "Pi specification run",
		ask: "Pi answer run",
		vibe: "Pi implementation run",
		auto: "Pi adaptive run",
		agent: "Pi delegated agent run",
		pair: "Paired Pi delegation",
	}[mode];
}

export function promptForMode(
	content: string,
	mode: PiRunMode,
	systemPrompt?: string,
): string {
	const instructions: Record<PiRunMode, string[]> = {
		space: [
			"Run the space.full_duplex profile: you are the meeting agent and the only user-facing voice.",
			"Keep the user channel open. Treat later input as status questions, constraints, target adjustments, or control instructions for this task.",
			"Before finalizing substantial work, use the subagent tool for task planning and independent supervision. Synthesize child results; do not expose raw child transcripts as user replies.",
			"Use the smallest safe execution plan and report progress, partial results, evidence, and unresolved risks.",
		],
		plan: [
			"Act as a planning agent.",
			"Do not edit files or execute mutation tools.",
			"Return a concise implementation plan with ordered steps, affected files, validation, and explicit risks.",
		],
		spec: [
			"Act as a specification agent.",
			"Do not edit files or execute mutation tools.",
			"Clarify requirements, invariants, acceptance criteria, edge cases, and unresolved decisions before proposing work.",
		],
		ask: [
			"Answer the request directly.",
			"Use read-only inspection only when it materially improves correctness. Do not edit files.",
		],
		vibe: [
			"Implement the user's request directly.",
			"Inspect the relevant code first, make the smallest complete change, and validate it before responding.",
		],
		auto: [
			"Choose the smallest correct response: answer directly for questions, plan for ambiguous work, and implement only when the request is sufficiently concrete.",
			"State which path you chose and validate any code change.",
		],
		agent: [
			"Run this as an autonomous coding-agent task.",
			"Inspect relevant code, execute the smallest complete solution, and report verification plus residual risks.",
		],
		pair: [
			"Run this request in paired-agent mode.",
			"Before writing your answer, call the subagent tool once with exactly two parallel, read-only tasks: a scout to inspect the request and a reviewer to independently check risks and omissions.",
			"Do not ask either child to edit files. Synthesize both results into your final response.",
		],
	};
	return [
		...instructions[mode],
		...(systemPrompt?.trim()
			? ["Configured agent instruction:", systemPrompt.trim()]
			: []),
		"User request:",
		content,
	].join("\n\n");
}

function defaultRunConfig(mode: PiRunMode): PiRunConfig {
	return {
		agentProfileId: mode === "space" ? "space.full_duplex" : `${mode}.default`,
		configVersion: 1,
		initialContextRevision: 0,
	};
}

function defaultAgentPrompt(agent: PiRunAgentConfig): string {
	const prompts: Record<string, string> = {
		context_compressor:
			"Maintain compact, versioned task context. Return structured context patches only; never change the user goal.",
		skill_recommender:
			"Recommend the smallest capable agents, tools, permissions, dependencies, and verification for the task. Do not execute it.",
		supervisor:
			"Independently review the task result and return pass, revise, or escalate with concrete evidence. Do not edit files.",
		evolution:
			"After completion, produce reviewable memory candidates with evidence, confidence, applicability, and invalidation conditions.",
		task_planner:
			"Act as the execution coordinator. Build the dependency-aware task graph, dispatch-ready work, completion criteria, and replanning guidance.",
		worker_pool:
			"Execute the assigned scoped task with least privilege. Return artifacts, evidence, warnings, errors, and a context patch; never address the user directly.",
	};
	return (
		prompts[agent.agentType] ??
		`Perform the configured ${agent.name} role and return concise evidence to the meeting agent.`
	);
}

function chunk(
	runId: string,
	sessionId: string,
	kind: string,
	extra: Record<string, unknown>,
): Chunk {
	return {
		run_id: runId,
		session_id: sessionId,
		purpose: "pi",
		provider_instance_id: "pi",
		effective_model: null,
		kind,
		is_retryable: false,
		fallback_provider_selected: false,
		...extra,
	};
}

function summarize(value: unknown): string {
	try {
		return truncate(
			JSON.stringify(value, (key, entry) =>
				/(api[_-]?key|authorization|cookie|password|secret|token)/i.test(key)
					? "[redacted]"
					: entry,
			),
			1000,
		);
	} catch {
		return truncate(String(value), 1000);
	}
}

function compactEvidence(value: unknown): string[] {
	const summary = summarize(value);
	return summary && summary !== "undefined" ? [summary] : [];
}

function truncate(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function isSubagentExecution(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const input = value as Record<string, unknown>;
	const action = typeof input.action === "string" ? input.action : undefined;
	if (action && !["", "run", "execute"].includes(action)) return false;
	return Boolean(
		typeof input.agent === "string" ||
			input.tasks ||
			input.chain ||
			input.parallel,
	);
}

export function subagentNames(value: unknown): string[] {
	const names = new Set<string>();
	function visit(candidate: unknown): void {
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item);
			return;
		}
		if (!candidate || typeof candidate !== "object") return;
		const input = candidate as Record<string, unknown>;
		if (typeof input.agent === "string") names.add(input.agent);
		for (const key of ["tasks", "chain", "parallel"]) visit(input[key]);
	}
	visit(value);
	return [...names];
}

function modelInfo(model: unknown): ModelInfo | null {
	if (!model || typeof model !== "object") return null;
	const value = model as Record<string, unknown>;
	return {
		provider: typeof value.provider === "string" ? value.provider : undefined,
		id: typeof value.id === "string" ? value.id : undefined,
		name: typeof value.name === "string" ? value.name : undefined,
		contextWindow:
			typeof value.contextWindow === "number" ? value.contextWindow : undefined,
		maxTokens:
			typeof value.maxTokens === "number" ? value.maxTokens : undefined,
		reasoning: value.reasoning === true,
	};
}

export function lastAssistantResult(messages: readonly unknown[]): {
	content?: string;
	error?: string;
} {
	for (const message of [...messages].reverse()) {
		if (!message || typeof message !== "object") continue;
		const value = message as Record<string, unknown>;
		if (value.role !== "assistant") continue;
		if (typeof value.errorMessage === "string") {
			return { error: value.errorMessage };
		}
		const content = value.content;
		if (typeof content === "string") return { content };
		if (!Array.isArray(content)) continue;
		const text = content
			.filter(
				(part): part is Record<string, unknown> =>
					!!part && typeof part === "object",
			)
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text as string)
			.join("");
		if (text) return { content: text };
	}
	return {};
}
