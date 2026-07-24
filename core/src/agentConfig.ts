import type { CoreStore } from "./store.js";
import { now, stringOr } from "./store.js";

export type PiModelInfo = { provider?: string; id?: string; name?: string };

export interface AgentProfile extends Record<string, unknown> {
	id: string;
	name: string;
	layer: "operation" | "execution";
	agent_type: string;
	mode: "default" | "parallel";
	description: string;
	model_route_purpose: "pi";
	allowed_tools: string[];
	capabilities: string[];
	system_prompt: string | null;
	enabled: boolean;
	is_built_in: true;
	updated_at: string | null;
	config_version: number;
	runtime_binding?: unknown;
}

export interface ResolvedRuntimeBinding {
	selection_kind: "inherit" | "fixed_model" | "provider_auto";
	source: "pi-runtime" | "agent_binding";
	writable: true;
	route_purpose: "pi";
	runtime_kind: "model";
	runtime_id: null;
	provider_instance_id: string | null;
	provider_display_name: string | null;
	model_id: string | null;
	model_source: "unset" | "agent_binding";
	shared_agent_ids: string[];
	warnings: never[];
}

const SUPPORTED_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"edit",
	"write",
	"subagent",
]);

const AGENT_DEFAULTS: ReadonlyArray<
	readonly [
		id: string,
		name: string,
		layer: AgentProfile["layer"],
		agentType: string,
		description: string,
		allowedTools: readonly string[],
	]
> = [
	[
		"operation-meeting",
		"Meeting",
		"operation",
		"meeting",
		"User-facing coordinator for the full-duplex workspace.",
		["read", "bash", "edit", "write", "subagent"],
	],
	[
		"operation-context-compressor",
		"Context Compressor",
		"operation",
		"context_compressor",
		"Maintains compact, versioned task context.",
		["read", "grep", "find", "ls"],
	],
	[
		"operation-skill-recommender",
		"Skill Recommender",
		"operation",
		"skill_recommender",
		"Recommends the smallest capable tool and agent set.",
		["read", "grep", "find", "ls"],
	],
	[
		"operation-supervisor",
		"Supervisor",
		"operation",
		"supervisor",
		"Independently verifies risks and completion evidence.",
		["read", "grep", "find", "ls"],
	],
	[
		"operation-evolution",
		"Evolution",
		"operation",
		"evolution",
		"Produces reviewable memory candidates after a task.",
		["read", "grep", "find", "ls"],
	],
	[
		"execution-task-planner",
		"Task Planner",
		"execution",
		"task_planner",
		"Builds a dependency-aware execution plan.",
		["read", "grep", "find", "ls"],
	],
	[
		"execution-worker-pool",
		"Worker Pool",
		"execution",
		"worker_pool",
		"Executes scoped work and returns evidence.",
		["read", "bash", "edit", "write"],
	],
];

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function bounded(value: unknown, fallback: string, max: number): string {
	return typeof value === "string" &&
		value.trim().length > 0 &&
		value.trim().length <= max
		? value.trim()
		: fallback;
}

function nullableBounded(value: unknown, max: number): string | null {
	return typeof value === "string" &&
		value.trim().length > 0 &&
		value.trim().length <= max
		? value.trim()
		: null;
}

function strings(value: unknown, fallback: readonly string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	return [
		...new Set(
			value
				.filter(
					(item): item is string => typeof item === "string" && item.length > 0,
				)
				.slice(0, 32),
		),
	];
}

function profileMode(value: unknown): AgentProfile["mode"] {
	return value === "default" || value === "parallel" ? value : "parallel";
}

function allowedTools(value: unknown, fallback: readonly string[]): string[] {
	const selected = strings(value, fallback).filter((tool) =>
		SUPPORTED_TOOLS.has(tool),
	);
	return selected.length > 0 ? selected : [...fallback];
}

function mergeProfile(
	base: (typeof AGENT_DEFAULTS)[number],
	override: Record<string, unknown> | undefined,
): AgentProfile {
	const [id, name, layer, agent_type, description, tools] = base;
	return {
		id,
		name,
		layer,
		agent_type,
		mode: profileMode(override?.mode),
		description: bounded(override?.description, description, 2_000),
		model_route_purpose: "pi",
		allowed_tools: allowedTools(override?.allowed_tools, tools),
		capabilities: strings(override?.capabilities, ["pi", "subagent"]),
		system_prompt: nullableBounded(override?.system_prompt, 8_000),
		enabled: typeof override?.enabled === "boolean" ? override.enabled : true,
		is_built_in: true,
		updated_at:
			typeof override?.updated_at === "string" ? override.updated_at : null,
		config_version:
			typeof override?.config_version === "number"
				? override.config_version
				: 1,
		runtime_binding: override?.runtime_binding,
	};
}

export function agentProfiles(store: CoreStore): AgentProfile[] {
	const overrides = new Map(
		store.list("agents").map((agent) => [stringOr(agent.id, ""), agent]),
	);
	return AGENT_DEFAULTS.map((base) =>
		mergeProfile(base, overrides.get(base[0])),
	);
}

export function resolvedRuntimeBinding(
	agent: AgentProfile,
	models: PiModelInfo[],
): ResolvedRuntimeBinding {
	const input = record(agent.runtime_binding);
	const selection = input.selection_kind;
	const provider =
		typeof input.provider_instance_id === "string"
			? input.provider_instance_id.replace(/^pi:/, "")
			: undefined;
	const modelId =
		typeof input.model_id === "string" ? input.model_id : undefined;
	const model =
		provider && modelId
			? models.find(
					(candidate) =>
						candidate.provider === provider && candidate.id === modelId,
				)
			: undefined;
	if (selection === "fixed_model" && model && provider) {
		return {
			selection_kind: "fixed_model",
			source: "agent_binding",
			writable: true,
			route_purpose: "pi",
			runtime_kind: "model",
			runtime_id: null,
			provider_instance_id: `pi:${provider}`,
			provider_display_name: model.name ?? provider,
			model_id: model.id ?? null,
			model_source: "agent_binding",
			shared_agent_ids: [],
			warnings: [],
		};
	}
	if (
		selection === "provider_auto" &&
		provider &&
		models.some((candidate) => candidate.provider === provider)
	) {
		return {
			selection_kind: "provider_auto",
			source: "agent_binding",
			writable: true,
			route_purpose: "pi",
			runtime_kind: "model",
			runtime_id: null,
			provider_instance_id: `pi:${provider}`,
			provider_display_name: provider,
			model_id: null,
			model_source: "agent_binding",
			shared_agent_ids: [],
			warnings: [],
		};
	}
	return {
		selection_kind: "inherit",
		source: "pi-runtime",
		writable: true,
		route_purpose: "pi",
		runtime_kind: "model",
		runtime_id: null,
		provider_instance_id: null,
		provider_display_name: null,
		model_id: null,
		model_source: "unset",
		shared_agent_ids: [],
		warnings: [],
	};
}

export async function saveProfile(
	store: CoreStore,
	agentId: string,
	input: Record<string, unknown>,
): Promise<AgentProfile | undefined> {
	const existing = agentProfiles(store).find((agent) => agent.id === agentId);
	if (!existing) return undefined;
	const updated: AgentProfile = {
		...existing,
		description: bounded(input.description, existing.description, 2_000),
		allowed_tools: allowedTools(input.allowed_tools, existing.allowed_tools),
		capabilities: strings(input.capabilities, existing.capabilities),
		system_prompt: nullableBounded(input.system_prompt, 8_000),
		enabled:
			typeof input.enabled === "boolean" ? input.enabled : existing.enabled,
		updated_at: now(),
		config_version: existing.config_version + 1,
	};
	await store.upsert("agents", updated);
	return updated;
}

export async function saveProfileMode(
	store: CoreStore,
	agentId: string,
	mode: unknown,
): Promise<AgentProfile | undefined> {
	const existing = agentProfiles(store).find((agent) => agent.id === agentId);
	if (!existing || (mode !== "default" && mode !== "parallel"))
		return undefined;
	const updated: AgentProfile = {
		...existing,
		mode,
		updated_at: now(),
		config_version: existing.config_version + 1,
	};
	await store.upsert("agents", updated);
	return updated;
}

export async function saveRuntimeBinding(
	store: CoreStore,
	agentId: string,
	input: Record<string, unknown>,
	models: PiModelInfo[],
): Promise<AgentProfile | undefined> {
	const existing = agentProfiles(store).find((agent) => agent.id === agentId);
	if (!existing) return undefined;
	const selection = input.selection_kind;
	if (
		selection !== "inherit" &&
		selection !== "fixed_model" &&
		selection !== "provider_auto"
	) {
		throw new Error("Only isolated Pi model bindings are currently supported.");
	}
	const provider =
		typeof input.provider_instance_id === "string"
			? input.provider_instance_id.replace(/^pi:/, "")
			: undefined;
	const modelId =
		typeof input.model_id === "string" ? input.model_id : undefined;
	if (
		selection === "fixed_model" &&
		!models.some((model) => model.provider === provider && model.id === modelId)
	) {
		throw new Error("The selected Pi model is not configured.");
	}
	if (
		selection === "provider_auto" &&
		!models.some((model) => model.provider === provider)
	) {
		throw new Error("The selected Pi provider is not configured.");
	}
	const runtime_binding =
		selection === "inherit"
			? { selection_kind: "inherit" }
			: selection === "fixed_model"
				? {
						selection_kind: selection,
						provider_instance_id: `pi:${provider}`,
						model_id: modelId,
					}
				: { selection_kind: selection, provider_instance_id: `pi:${provider}` };
	const updated: AgentProfile = {
		...existing,
		runtime_binding,
		updated_at: now(),
		config_version: existing.config_version + 1,
	};
	await store.upsert("agents", updated);
	return updated;
}

export interface PiRunAgentConfig {
	id: string;
	name: string;
	layer: AgentProfile["layer"];
	agentType: string;
	runtimeAgent: string;
	mode: AgentProfile["mode"];
	allowedTools: string[];
	systemPrompt?: string;
	model?: { provider: string; id: string };
}

function boundModel(
	agent: AgentProfile,
	models: PiModelInfo[],
): { provider: string; id: string } | undefined {
	const binding = resolvedRuntimeBinding(agent, models);
	if (
		binding.selection_kind === "fixed_model" &&
		binding.provider_instance_id &&
		binding.model_id
	) {
		return {
			provider: binding.provider_instance_id.replace(/^pi:/, ""),
			id: binding.model_id,
		};
	}
	if (
		binding.selection_kind === "provider_auto" &&
		binding.provider_instance_id
	) {
		const provider = binding.provider_instance_id.replace(/^pi:/, "");
		const model = models.find(
			(candidate) => candidate.provider === provider && candidate.id,
		);
		if (model?.id) return { provider, id: model.id };
	}
	return undefined;
}

const RUNTIME_AGENTS: Record<string, string> = {
	"operation-meeting": "parent",
	"operation-context-compressor": "context-compressor",
	"operation-skill-recommender": "skill-recommender",
	"operation-supervisor": "supervisor",
	"operation-evolution": "evolution",
	"execution-task-planner": "task-planner",
	"execution-worker-pool": "worker-pool",
};

function runtimeAgentName(agent: AgentProfile): string {
	const role =
		RUNTIME_AGENTS[agent.id] ?? agent.agent_type.replaceAll("_", "-");
	return role === "parent" ? role : `tinadec-${role}-v${agent.config_version}`;
}

export function fullDuplexRunConfig(
	store: CoreStore,
	models: PiModelInfo[],
	mode: string,
): {
	agentProfileId: string;
	configVersion: number;
	initialContextRevision: number;
	systemPrompt?: string;
	fixedModel?: { provider: string; id: string };
	allowedTools: string[];
	agents: PiRunAgentConfig[];
} {
	const profiles = agentProfiles(store);
	const meeting = profiles.find((agent) => agent.id === "operation-meeting");
	if (!meeting?.enabled) throw new Error("The meeting agent is disabled.");
	const activeProfiles =
		mode === "space" ? profiles.filter((agent) => agent.enabled) : [meeting];
	if (mode === "space") {
		if (!meeting.allowed_tools.includes("subagent")) {
			throw new Error(
				"The space.full_duplex meeting agent requires the subagent tool.",
			);
		}
		for (const required of [
			"operation-supervisor",
			"execution-task-planner",
			"execution-worker-pool",
		]) {
			if (!activeProfiles.some((agent) => agent.id === required)) {
				throw new Error(`The space.full_duplex profile requires ${required}.`);
			}
		}
	}
	const agents = activeProfiles.map((agent) => ({
		id: agent.id,
		name: agent.name,
		layer: agent.layer,
		agentType: agent.agent_type,
		runtimeAgent: runtimeAgentName(agent),
		mode: agent.mode,
		allowedTools: agent.allowed_tools,
		systemPrompt: agent.system_prompt ?? undefined,
		model: boundModel(agent, models),
	}));
	const profileContract =
		mode === "space"
			? [
					"Frozen space.full_duplex role configuration:",
					...agents.map((agent) =>
						[
							`- ${agent.id} -> ${agent.runtimeAgent}; scheduling=${agent.mode}; tools=${agent.allowedTools.join(",") || "none"}`,
							agent.model
								? `model=${agent.model.provider}/${agent.model.id}`
								: "model=inherit",
							agent.systemPrompt ? `instruction=${agent.systemPrompt}` : "",
						]
							.filter(Boolean)
							.join("; "),
					),
					"Required execution contract:",
					`1. Call the subagent tool with ${agents.find((agent) => agent.agentType === "task_planner")?.runtimeAgent} to produce the execution plan.`,
					`2. Call the subagent tool with ${agents.find((agent) => agent.agentType === "worker_pool")?.runtimeAgent} to execute the approved scoped work.`,
					`3. Call the subagent tool with ${agents.find((agent) => agent.agentType === "supervisor")?.runtimeAgent} for independent final supervision before replying.`,
					"Only the parent meeting agent may address the user. Synthesize child results and keep later user input available through the parent control channel.",
				].join("\n")
			: undefined;
	const readOnlyMode = mode === "plan" || mode === "spec" || mode === "ask";
	return {
		agentProfileId: mode === "space" ? "space.full_duplex" : `${mode}.default`,
		configVersion: Math.max(
			...activeProfiles.map((agent) => agent.config_version),
		),
		initialContextRevision: 0,
		systemPrompt:
			[meeting.system_prompt, profileContract].filter(Boolean).join("\n\n") ||
			undefined,
		fixedModel: boundModel(meeting, models),
		allowedTools: readOnlyMode
			? meeting.allowed_tools.filter((tool) =>
					["read", "grep", "find", "ls"].includes(tool),
				)
			: meeting.allowed_tools,
		agents,
	};
}
