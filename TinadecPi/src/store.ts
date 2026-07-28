import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type RecordValue = Record<string, unknown>;

export interface Project extends RecordValue {
	id: string;
	name: string;
	path: string;
	created_at: string;
}

export interface Session extends RecordValue {
	id: string;
	project_id: string;
	title: string;
	status: string;
	created_at: string;
	updated_at: string;
	pi_session_file?: string;
}

export interface Message extends RecordValue {
	id: string;
	session_id: string;
	run_id?: string;
	role: string;
	content: string;
	created_at: string;
}

export interface PiRun extends RecordValue {
	id: string;
	session_id: string;
	user_message_id?: string;
	assistant_message_id?: string;
	mode: "space" | "plan" | "spec" | "ask" | "vibe" | "auto" | "agent" | "pair";
	agent_profile_id: string;
	config_version: number;
	initial_context_revision: number;
	status: "running" | "completed" | "failed" | "cancelled";
	summary: string;
	error?: string;
	created_at: string;
	updated_at: string;
}

export interface PiArtifact extends RecordValue {
	id: string;
	run_id: string;
	session_id: string;
	kind: "plan" | "spec";
	title: string;
	path: string;
	created_at: string;
}

export interface PiToolExecution extends RecordValue {
	id: string;
	run_id: string;
	session_id: string;
	tool_id: string;
	tool_display_name: string;
	source: "pi";
	provider_layer: "pi-agent-sdk";
	risk: "unknown";
	requires_approval: boolean;
	status: "running" | "completed" | "failed";
	approval_id?: string | null;
	step_result_id?: string | null;
	summary: string;
	evidence: string[];
	requested_at: string;
	updated_at: string;
	duration_ms: number;
	requested_seq: number;
	updated_seq: number;
	event_types: string[];
	checkpoint_summary: string;
}

export interface PiAgentExecution extends RecordValue {
	id: string;
	run_id: string;
	session_id: string;
	agent_id: string;
	agent_name: string;
	agent_type: string;
	agent_layer?: "operation" | "execution";
	runtime_agent?: string;
	direct_user_output?: boolean;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	task: string;
	created_at: string;
	updated_at: string;
}

export interface EventEnvelope extends RecordValue {
	v: string;
	type: string;
	request_id: string;
	session_id: string | null;
	trace_id: string;
	seq: number;
	ts: string;
	capabilities: string[];
	payload: RecordValue | null;
}

interface State {
	projects: Project[];
	sessions: Session[];
	messages: Message[];
	approvals: RecordValue[];
	providers: RecordValue[];
	routes: RecordValue[];
	agents: RecordValue[];
	prompts: RecordValue[];
	prompt_versions: RecordValue[];
	extension_sources: RecordValue[];
	extensions: RecordValue[];
	runs: PiRun[];
	artifacts: PiArtifact[];
	tool_executions: PiToolExecution[];
	agent_executions: PiAgentExecution[];
	events: EventEnvelope[];
	sequence: number;
}

const EMPTY_STATE: State = {
	projects: [],
	sessions: [],
	messages: [],
	approvals: [],
	providers: [],
	routes: [],
	agents: [],
	prompts: [],
	prompt_versions: [],
	extension_sources: [],
	extensions: [],
	runs: [],
	artifacts: [],
	tool_executions: [],
	agent_executions: [],
	events: [],
	sequence: 0,
};

export class CoreStore {
	private state: State = structuredClone(EMPTY_STATE);
	private readonly listeners = new Set<(event: EventEnvelope) => void>();
	private writeTail: Promise<void> = Promise.resolve();

	constructor(private readonly filePath: string) {}

	async load(): Promise<void> {
		try {
			const parsed = JSON.parse(
				await readFile(this.filePath, "utf8"),
			) as Partial<State>;
			this.state = {
				...structuredClone(EMPTY_STATE),
				...parsed,
				runs: Array.isArray(parsed.runs) ? parsed.runs : [],
				artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
				tool_executions: Array.isArray(parsed.tool_executions)
					? parsed.tool_executions
					: [],
				agent_executions: Array.isArray(parsed.agent_executions)
					? parsed.agent_executions
					: [],
				events: Array.isArray(parsed.events) ? parsed.events : [],
				sequence: typeof parsed.sequence === "number" ? parsed.sequence : 0,
			};
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "ENOENT"
			)
				throw error;
		}
	}

	listProjects(): Project[] {
		return [...this.state.projects];
	}

	getProject(id: string): Project | undefined {
		return this.state.projects.find((project) => project.id === id);
	}

	async createProject(name: string, workspacePath: string): Promise<Project> {
		const project: Project = {
			id: id("project"),
			name,
			path: workspacePath,
			created_at: now(),
		};
		this.state.projects.push(project);
		await this.save();
		return project;
	}

	listSessions(projectId?: string): Session[] {
		return this.state.sessions
			.filter((session) => !projectId || session.project_id === projectId)
			.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
	}

	getSession(id: string): Session | undefined {
		return this.state.sessions.find((session) => session.id === id);
	}

	async createSession(projectId: string, title?: string): Promise<Session> {
		const timestamp = now();
		const session: Session = {
			id: id("session"),
			project_id: projectId,
			title: title?.trim() || "New Pi session",
			status: "idle",
			created_at: timestamp,
			updated_at: timestamp,
		};
		this.state.sessions.push(session);
		await this.save();
		return session;
	}

	async updateSession(
		idValue: string,
		patch: Partial<Pick<Session, "title" | "status" | "pi_session_file">>,
	): Promise<Session | undefined> {
		const session = this.getSession(idValue);
		if (!session) return undefined;
		Object.assign(session, patch, { updated_at: now() });
		await this.save();
		return session;
	}

	listMessages(sessionId: string): Message[] {
		return this.state.messages.filter(
			(message) => message.session_id === sessionId,
		);
	}

	async addMessage(
		sessionId: string,
		role: string,
		content: string,
		runId?: string,
	): Promise<Message> {
		const message: Message = {
			id: id("message"),
			session_id: sessionId,
			...(runId ? { run_id: runId } : {}),
			role,
			content,
			created_at: now(),
		};
		this.state.messages.push(message);
		await this.save();
		return message;
	}

	async createRun(
		sessionId: string,
		mode: PiRun["mode"],
		summary: string,
		options: {
			userMessageId?: string;
			agentProfileId: string;
			configVersion: number;
			initialContextRevision: number;
		} = {
			agentProfileId: "space.full_duplex",
			configVersion: 1,
			initialContextRevision: 0,
		},
	): Promise<PiRun> {
		const timestamp = now();
		const run: PiRun = {
			id: id("run"),
			session_id: sessionId,
			...(options.userMessageId
				? { user_message_id: options.userMessageId }
				: {}),
			mode,
			agent_profile_id: options.agentProfileId,
			config_version: options.configVersion,
			initial_context_revision: options.initialContextRevision,
			status: "running",
			summary,
			created_at: timestamp,
			updated_at: timestamp,
		};
		this.state.runs.push(run);
		await this.save();
		return run;
	}

	getRun(runId: string): PiRun | undefined {
		return this.state.runs.find((run) => run.id === runId);
	}

	listRuns(sessionId: string, limit = 50): PiRun[] {
		return this.state.runs
			.filter((run) => run.session_id === sessionId)
			.sort((left, right) => right.created_at.localeCompare(left.created_at))
			.slice(0, limit);
	}

	async createArtifact(
		input: Pick<
			PiArtifact,
			"run_id" | "session_id" | "kind" | "title" | "path"
		>,
	): Promise<PiArtifact> {
		const artifact: PiArtifact = {
			id: id("artifact"),
			...input,
			created_at: now(),
		};
		this.state.artifacts.push(artifact);
		await this.save();
		return artifact;
	}

	listArtifacts(sessionId: string, runId?: string): PiArtifact[] {
		return this.state.artifacts.filter(
			(artifact) =>
				artifact.session_id === sessionId &&
				(!runId || artifact.run_id === runId),
		);
	}

	getArtifact(artifactId: string): PiArtifact | undefined {
		return this.state.artifacts.find((artifact) => artifact.id === artifactId);
	}

	async updateRun(
		runId: string,
		patch: Partial<Pick<PiRun, "status" | "assistant_message_id" | "error">>,
	): Promise<PiRun | undefined> {
		const run = this.getRun(runId);
		if (!run) return undefined;
		Object.assign(run, patch, { updated_at: now() });
		await this.save();
		return run;
	}

	listToolExecutions(
		sessionId: string,
		runId?: string,
		limit = 50,
	): PiToolExecution[] {
		return this.state.tool_executions
			.filter(
				(execution) =>
					execution.session_id === sessionId &&
					(!runId || execution.run_id === runId),
			)
			.sort((left, right) =>
				right.requested_at.localeCompare(left.requested_at),
			)
			.slice(0, limit);
	}

	getToolExecution(idValue: string): PiToolExecution | undefined {
		return this.state.tool_executions.find(
			(execution) => execution.id === idValue,
		);
	}

	async upsertToolExecution(
		execution: PiToolExecution,
	): Promise<PiToolExecution> {
		const index = this.state.tool_executions.findIndex(
			(item) => item.id === execution.id,
		);
		if (index >= 0) this.state.tool_executions[index] = execution;
		else this.state.tool_executions.push(execution);
		this.state.tool_executions = this.state.tool_executions.slice(-500);
		await this.save();
		return execution;
	}

	listAgentExecutions(runId: string): PiAgentExecution[] {
		return this.state.agent_executions.filter(
			(agent) => agent.run_id === runId,
		);
	}

	async upsertAgentExecution(
		agent: PiAgentExecution,
	): Promise<PiAgentExecution> {
		const index = this.state.agent_executions.findIndex(
			(item) => item.id === agent.id,
		);
		if (index >= 0) this.state.agent_executions[index] = agent;
		else this.state.agent_executions.push(agent);
		this.state.agent_executions = this.state.agent_executions.slice(-100);
		await this.save();
		return agent;
	}

	listApprovals(sessionId?: string, status?: string): RecordValue[] {
		return this.state.approvals.filter(
			(approval) =>
				(!sessionId || approval.session_id === sessionId) &&
				(!status || approval.status === status),
		);
	}

	async createApproval(input: RecordValue): Promise<RecordValue> {
		const approval = {
			id: id("approval"),
			session_id: stringOrNull(input.session_id),
			kind: stringOr(input.kind, "tool"),
			summary: stringOr(input.summary, "Approval required"),
			command: stringOrNull(input.command),
			cwd: stringOrNull(input.cwd),
			status: "pending",
			created_at: now(),
			decided_at: null,
		};
		this.state.approvals.push(approval);
		await this.save();
		return approval;
	}

	async decideApproval(
		idValue: string,
		decision: "approved" | "rejected",
	): Promise<RecordValue | undefined> {
		const approval = this.state.approvals.find((item) => item.id === idValue);
		if (!approval) return undefined;
		approval.status = decision;
		approval.decided_at = now();
		await this.save();
		return approval;
	}

	list(
		key: keyof Pick<
			State,
			| "providers"
			| "routes"
			| "agents"
			| "prompts"
			| "prompt_versions"
			| "extension_sources"
			| "extensions"
		>,
	): RecordValue[] {
		return [...this.state[key]] as RecordValue[];
	}

	find(
		key: keyof Pick<
			State,
			| "providers"
			| "routes"
			| "agents"
			| "prompts"
			| "extension_sources"
			| "extensions"
		>,
		idValue: string,
	): RecordValue | undefined {
		return (this.state[key] as RecordValue[]).find(
			(item) => item.id === idValue,
		);
	}

	async upsert(
		key: keyof Pick<
			State,
			| "providers"
			| "routes"
			| "agents"
			| "prompts"
			| "extension_sources"
			| "extensions"
		>,
		value: RecordValue,
	): Promise<RecordValue> {
		const items = this.state[key] as RecordValue[];
		const position = items.findIndex((item) => item.id === value.id);
		if (position >= 0) items[position] = value;
		else items.push(value);
		await this.save();
		return value;
	}

	async remove(
		key: keyof Pick<State, "providers" | "prompts" | "extensions">,
		idValue: string,
	): Promise<boolean> {
		const items = this.state[key] as RecordValue[];
		const position = items.findIndex((item) => item.id === idValue);
		if (position < 0) return false;
		items.splice(position, 1);
		await this.save();
		return true;
	}

	listEvents(sessionId?: string): EventEnvelope[] {
		return this.state.events.filter(
			(event) => !sessionId || event.session_id === sessionId,
		);
	}

	async publish(
		type: string,
		sessionId: string | null,
		payload: RecordValue | null = null,
		capabilities: string[] = [],
	): Promise<EventEnvelope> {
		const event: EventEnvelope = {
			v: "1",
			type,
			request_id: id("request"),
			session_id: sessionId,
			trace_id: id("trace"),
			seq: ++this.state.sequence,
			ts: now(),
			capabilities,
			payload,
		};
		this.state.events.push(event);
		this.state.events = this.state.events.slice(-500);
		await this.save();
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A dead SSE subscriber (closed stream controller) must not break
				// event publication for everyone else.
			}
		}
		return event;
	}

	subscribe(listener: (event: EventEnvelope) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private save(): Promise<void> {
		const snapshot = `${JSON.stringify(this.state, null, 2)}\n`;
		const write = this.writeTail.then(async () => {
			await mkdir(dirname(this.filePath), { recursive: true });
			const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
			await writeFile(temporary, snapshot, "utf8");
			await rename(temporary, this.filePath);
		});
		// Keep the tail resolved even when a write fails, otherwise one transient
		// error (e.g. a Windows rename lock) would poison every later save.
		this.writeTail = write.catch(() => undefined);
		return write;
	}
}

export function defaultStatePath(cwd = process.cwd()): string {
	return process.env.TINADEC_DATA_DIR
		? join(process.env.TINADEC_DATA_DIR, "state.json")
		: join(cwd, ".tinadec-pi", "state.json");
}

export function id(prefix: string): string {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function now(): string {
	return new Date().toISOString();
}

export function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
