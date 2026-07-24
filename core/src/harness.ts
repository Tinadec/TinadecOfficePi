import { createRequire } from "node:module";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	getAgentDir,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { type CoreStore, id } from "./store.js";

type Chunk = Record<string, unknown>;
type LiveSession = { session: AgentSession; cwd: string };
type ModelInfo = {
	provider?: string;
	id?: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
};

const require = createRequire(import.meta.url);
const agentDir = process.env.TINADEC_PI_AGENT_DIR ?? getAgentDir();
const subagentsExtension = require.resolve("pi-subagents");

export class PiHarness {
	private readonly live = new Map<string, LiveSession>();
	private readonly invocationTails = new Map<string, Promise<void>>();
	private readonly modelRuntime = ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
	});

	constructor(private readonly store: CoreStore) {}

	async invoke(
		sessionId: string,
		content: string,
		onChunk?: (chunk: Chunk) => void,
	): Promise<{ run_id: string; content: string }> {
		return this.enqueue(sessionId, () =>
			this.invokeOne(sessionId, content, onChunk),
		);
	}

	private async invokeOne(
		sessionId: string,
		content: string,
		onChunk?: (chunk: Chunk) => void,
	): Promise<{ run_id: string; content: string }> {
		const runId = id("run");
		const live = await this.open(sessionId);
		await this.store.updateSession(sessionId, { status: "running" });
		await this.store.publish("run.started", sessionId, { run_id: runId }, [
			"pi.agent",
		]);
		onChunk?.(
			chunk(runId, sessionId, "context", { delta: "Pi session started." }),
		);

		const unsubscribe = live.session.subscribe((event) => {
			if (
				event.type === "message_update" &&
				event.assistantMessageEvent.type === "text_delta"
			) {
				onChunk?.(
					chunk(runId, sessionId, "delta", {
						delta: event.assistantMessageEvent.delta,
					}),
				);
			}
			if (event.type === "tool_execution_start") {
				onChunk?.(
					chunk(runId, sessionId, "tool_call_delta", {
						tool_call_delta: {
							call_id: event.toolCallId,
							tool_id: event.toolName,
							arguments: event.args as Record<string, unknown>,
						},
					}),
				);
			}
		});

		try {
			const messageCount = live.session.messages.length;
			await live.session.prompt(content);
			const result = lastAssistantResult(
				live.session.messages.slice(messageCount),
			);
			if (!result.content) {
				throw new Error(result.error ?? "Pi did not return an assistant response.");
			}
			const output = result.content;
			await this.store.addMessage(sessionId, "assistant", output);
			await this.store.updateSession(sessionId, { status: "idle" });
			await this.store.publish(
				"message.created",
				sessionId,
				{ role: "assistant", run_id: runId },
				["pi.agent"],
			);
			await this.store.publish("run.completed", sessionId, { run_id: runId }, [
				"pi.agent",
			]);
			onChunk?.(chunk(runId, sessionId, "done", { finish_reason: "stop" }));
			return { run_id: runId, content: output };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.store.updateSession(sessionId, { status: "failed" });
			await this.store.publish(
				"run.failed",
				sessionId,
				{ run_id: runId, message },
				["pi.agent"],
			);
			onChunk?.(
				chunk(runId, sessionId, "error", {
					safe_error_message: message,
					finish_reason: "error",
				}),
			);
			throw error;
		} finally {
			unsubscribe();
		}
	}

	private async enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
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

	async abort(sessionId: string): Promise<void> {
		await (await this.open(sessionId)).session.abort();
	}

	async state(sessionId: string): Promise<Record<string, unknown>> {
		const session = (await this.open(sessionId)).session;
		return {
			session_id: session.sessionId,
			session_file: session.sessionFile ?? null,
			model: modelInfo(session.model),
			thinking_level: session.thinkingLevel,
			is_streaming: session.isStreaming,
			message_count: session.messages.length,
			active_tools: session.agent.state.tools.map((tool) => tool.name),
			agent_dir: process.env.TINADEC_PI_AGENT_DIR ? "configured" : "default",
			multi_agent: session.agent.state.tools.some(
				(tool) => tool.name === "subagent",
			),
		};
	}

	async availableModels(): Promise<ModelInfo[]> {
		const runtime = await this.modelRuntime;
		return (await runtime.getAvailable()).flatMap((model) => {
			const info = modelInfo(model);
			return info ? [info] : [];
		});
	}

	private async open(sessionId: string): Promise<LiveSession> {
		const cached = this.live.get(sessionId);
		if (cached) return cached;

		const record = this.store.getSession(sessionId);
		if (!record) throw new Error("Session was not found.");
		const project = this.store.getProject(record.project_id);
		if (!project) throw new Error("Project was not found.");

		const loader = new DefaultResourceLoader({
			cwd: project.path,
			agentDir,
			additionalExtensionPaths: [subagentsExtension],
		});
		await loader.reload();

		const result = await createAgentSession({
			cwd: project.path,
			agentDir,
			modelRuntime: await this.modelRuntime,
			resourceLoader: loader,
			sessionManager: record.pi_session_file
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
