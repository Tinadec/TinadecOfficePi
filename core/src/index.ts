import { stat } from "node:fs/promises";
import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import { PiHarness } from "./harness.js";
import { CoreStore, defaultStatePath, id, now, stringOr } from "./store.js";

const port = Number(process.env.TINADEC_CORE_PORT ?? 48731);
const store = new CoreStore(defaultStatePath());
await store.load();
const pi = new PiHarness(store);

new Elysia({ adapter: node() })
	.get("/", () =>
		Response.redirect("http://127.0.0.1:" + port + "/api/v1/health"),
	)
	.get("/api/v1/health", () => ({
		name: "Tinadec Pi",
		status: "ok",
		version: "0.1.0",
		runtime: "pi-agent-sdk",
		time: now(),
	}))
	.get("/api/v1/doctor", async () => ({
		platform: process.platform,
		agent_core_version: "pi-agent-sdk",
		checks: [
			{
				name: "pi-sdk",
				status: "ready",
				message: "Pi Agent SDK is embedded in the Core process.",
			},
			{
				name: "pi-subagents",
				status: "ready",
				message: "pi-subagents is loaded as a Pi extension.",
			},
			{
				name: "models",
				status: (await pi.availableModels()).length > 0 ? "ready" : "warning",
				message: "Configure Pi authentication with pi /login or an API key.",
			},
		],
	}))
	.get("/api/v1/readiness", async () => readiness(await pi.availableModels()))
	.get("/api/v1/model-readiness", async () =>
		modelReadiness(await pi.availableModels()),
	)
	.get("/api/v1/model-catalog-readiness", async () =>
		modelCatalogReadiness(await pi.availableModels()),
	)
	.get("/api/v1/tool-layer-readiness", () => toolReadiness())
	.get("/api/v1/projects", () => store.listProjects())
	.post("/api/v1/projects", async ({ body, set }) => {
		const input = record(body);
		const workspacePath = stringOr(input.path, "");
		if (!workspacePath || !(await isDirectory(workspacePath)))
			return fail(
				set,
				400,
				"PROJECT_PATH_INVALID",
				"The selected project path does not exist.",
			);
		const project = await store.createProject(
			stringOr(
				input.name,
				workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? "Project",
			),
			workspacePath,
		);
		await store.publish(
			"project.created",
			null,
			{ project_id: project.id, path: project.path },
			["workspace.project"],
		);
		set.status = 201;
		return project;
	})
	.get("/api/v1/sessions", ({ query }) =>
		store.listSessions(stringValue(query.projectId)),
	)
	.post("/api/v1/sessions", async ({ body, set }) => {
		const input = record(body);
		const projectId = stringOr(input.project_id ?? input.projectId, "");
		if (!store.getProject(projectId))
			return fail(set, 404, "PROJECT_NOT_FOUND", "Project was not found.");
		const session = await store.createSession(
			projectId,
			stringValue(input.title),
		);
		await store.publish(
			"session.created",
			session.id,
			{ session_id: session.id, project_id: projectId },
			["agent.session"],
		);
		set.status = 201;
		return session;
	})
	.patch("/api/v1/sessions/:sessionId", async ({ params, body, set }) => {
		const updated = await store.updateSession(params.sessionId, {
			title: stringOr(record(body).title, "") || undefined,
		});
		return (
			updated ?? fail(set, 404, "SESSION_NOT_FOUND", "Session was not found.")
		);
	})
	.get("/api/v1/sessions/:sessionId/messages", ({ params, set }) => {
		if (!store.getSession(params.sessionId))
			return fail(set, 404, "SESSION_NOT_FOUND", "Session was not found.");
		return store.listMessages(params.sessionId);
	})
	.post(
		"/api/v1/sessions/:sessionId/messages",
		async ({ params, body, set }) => {
			const content = stringOr(record(body).content, "");
			if (!content)
				return fail(set, 400, "MESSAGE_EMPTY", "Message content is required.");
			if (!store.getSession(params.sessionId))
				return fail(set, 404, "SESSION_NOT_FOUND", "Session was not found.");
			await store.addMessage(params.sessionId, "user", content);
			await store.publish(
				"message.created",
				params.sessionId,
				{ role: "user" },
				["agent.message"],
			);
			try {
				const result = await pi.invoke(params.sessionId, content);
				return (
					store
						.listMessages(params.sessionId)
						.find(
							(message) =>
								message.content === result.content &&
								message.role === "assistant",
						) ?? { content: result.content }
				);
			} catch (error) {
				return fail(set, 502, "PI_INVOCATION_FAILED", safeError(error));
			}
		},
	)
	.post(
		"/api/v1/sessions/:sessionId/invoke-stream",
		async ({ params, body, set }) => {
			const content = stringOr(record(body).content, "");
			if (!content)
				return fail(set, 400, "MESSAGE_EMPTY", "Message content is required.");
			if (!store.getSession(params.sessionId))
				return fail(set, 404, "SESSION_NOT_FOUND", "Session was not found.");
			await store.addMessage(params.sessionId, "user", content);
			await store.publish(
				"message.created",
				params.sessionId,
				{ role: "user" },
				["agent.message"],
			);
			set.headers["content-type"] = "text/event-stream";
			set.headers["cache-control"] = "no-cache";
			return sse(async (send) => {
				await pi.invoke(params.sessionId, content, send);
			});
		},
	)
	.get("/api/v1/sessions/:sessionId/pi/state", async ({ params, set }) => {
		if (!store.getSession(params.sessionId))
			return fail(set, 404, "SESSION_NOT_FOUND", "Session was not found.");
		try {
			return await pi.state(params.sessionId);
		} catch (error) {
			return fail(set, 502, "PI_SESSION_UNAVAILABLE", safeError(error));
		}
	})
	.post("/api/v1/sessions/:sessionId/pi/steer", async ({ params, body, set }) =>
		queuePi(set, record(body).content, (content) =>
			pi.steer(params.sessionId, content),
		),
	)
	.post(
		"/api/v1/sessions/:sessionId/pi/follow-up",
		async ({ params, body, set }) =>
			queuePi(set, record(body).content, (content) =>
				pi.followUp(params.sessionId, content),
			),
	)
	.post("/api/v1/sessions/:sessionId/pi/abort", async ({ params, set }) => {
		try {
			await pi.abort(params.sessionId);
			return { status: "aborted" };
		} catch (error) {
			return fail(set, 409, "PI_ABORT_FAILED", safeError(error));
		}
	})
	.get("/api/v1/sessions/:sessionId/orchestration", () => orchestration())
	.get("/api/v1/sessions/:sessionId/runs", () => [])
	.get("/api/v1/sessions/:sessionId/task-nodes", () => [])
	.get("/api/v1/sessions/:sessionId/context-packs", () => [])
	.get("/api/v1/sessions/:sessionId/supervision-findings", () => [])
	.get("/api/v1/sessions/:sessionId/tool-executions", () => [])
	.get("/api/v1/events", ({ query, request }) =>
		eventStream(stringValue(query.sessionId), request.signal),
	)
	.get("/api/v1/approvals", ({ query }) =>
		store.listApprovals(
			stringValue(query.sessionId),
			stringValue(query.status),
		),
	)
	.post("/api/v1/approvals", async ({ body, set }) => {
		const approval = await store.createApproval(record(body));
		await store.publish(
			"approval.requested",
			stringValue(approval.session_id) ?? null,
			{ approval_id: approval.id, kind: approval.kind as string },
			["approval.ask"],
		);
		set.status = 201;
		return approval;
	})
	.post(
		"/api/v1/approvals/:approvalId/decision",
		async ({ params, body, set }) => {
			const decision = stringValue(record(body).decision);
			if (decision !== "approved" && decision !== "rejected")
				return fail(
					set,
					400,
					"APPROVAL_DECISION_INVALID",
					"Decision must be approved or rejected.",
				);
			const approval = await store.decideApproval(params.approvalId, decision);
			if (!approval)
				return fail(
					set,
					404,
					"APPROVAL_NOT_FOUND",
					"Approval request was not found.",
				);
			await store.publish(
				`approval.${decision}`,
				stringValue(approval.session_id) ?? null,
				{ approval_id: approval.id },
				["approval.decide"],
			);
			return approval;
		},
	)
	.post("/api/v1/tools/shell", async ({ body, set }) => {
		const approval = await store.createApproval({
			...record(body),
			kind: "shell",
		});
		set.status = 202;
		return approval;
	})
	.get("/api/v1/model-provider-templates", () => [piTemplate()])
	.get("/api/v1/model-providers", async () =>
		providers(await pi.availableModels()),
	)
	.post("/api/v1/model-providers", ({ set }) =>
		fail(
			set,
			501,
			"PI_CONFIGURATION_OWNED_BY_PI",
			"Configure model providers with Pi settings, pi /login, or models.json.",
		),
	)
	.put("/api/v1/model-providers/:providerInstanceId", ({ set }) =>
		fail(
			set,
			501,
			"PI_CONFIGURATION_OWNED_BY_PI",
			"Configure model providers with Pi settings, pi /login, or models.json.",
		),
	)
	.delete("/api/v1/model-providers/:providerInstanceId", ({ set }) =>
		fail(
			set,
			501,
			"PI_CONFIGURATION_OWNED_BY_PI",
			"Configure model providers with Pi settings, pi /login, or models.json.",
		),
	)
	.get("/api/v1/model-routes", () => [])
	.put("/api/v1/model-routes/:purpose", ({ set }) =>
		fail(
			set,
			501,
			"PI_CONFIGURATION_OWNED_BY_PI",
			"Pi selects models from its configured runtime.",
		),
	)
	.get("/api/v1/model-settings", () => ({
		base_url: "",
		model: "",
		has_api_key: false,
		updated_at: now(),
	}))
	.put("/api/v1/model-settings", ({ set }) =>
		fail(
			set,
			501,
			"PI_CONFIGURATION_OWNED_BY_PI",
			"Credentials are owned by Pi and are never accepted through this API.",
		),
	)
	.get("/api/v1/market/sources", () => store.list("extension_sources"))
	.post("/api/v1/market/sources", async ({ body, set }) => {
		const input = record(body);
		const source = {
			id: id("source"),
			name: stringOr(input.name, "Pi package"),
			kind: stringOr(input.kind, "npm"),
			location: stringOr(input.location, ""),
			enabled: input.enabled !== false,
			last_refreshed_at: null,
			created_at: now(),
		};
		await store.upsert("extension_sources", source);
		set.status = 201;
		return source;
	})
	.post(
		"/api/v1/market/sources/:sourceId/refresh",
		({ params, set }) =>
			store.find("extension_sources", params.sourceId) ??
			fail(
				set,
				404,
				"EXTENSION_SOURCE_NOT_FOUND",
				"Extension source was not found.",
			),
	)
	.get("/api/v1/market/catalog", () => [])
	.get("/api/v1/market/catalog/:catalogId", ({ set }) =>
		fail(
			set,
			404,
			"MARKET_CATALOG_ITEM_NOT_FOUND",
			"Marketplace catalog is not managed by the embedded Pi runtime.",
		),
	)
	.post("/api/v1/extensions/install-preview", ({ set }) =>
		fail(
			set,
			501,
			"PI_PACKAGE_MANAGEMENT_REQUIRED",
			"Install Pi packages with pi install so their code can be reviewed first.",
		),
	)
	.post("/api/v1/extensions/install", ({ set }) =>
		fail(
			set,
			501,
			"PI_PACKAGE_MANAGEMENT_REQUIRED",
			"Install Pi packages with pi install so their code can be reviewed first.",
		),
	)
	.get("/api/v1/extensions/installed", () => [
		{
			id: "pi-subagents",
			extension_id: "pi-subagents",
			kind: "extension",
			version: "0.35.1",
			publisher: "pi-subagents",
			display_name: "Pi Subagents",
			description: "Pi multi-agent delegation extension.",
			source_kind: "npm",
			source_location: "node_modules/pi-subagents",
			capabilities: ["subagents", "parallel", "chain"],
			permissions: [],
			enabled: true,
			status: "ready",
			status_message: "Loaded by TinadecPi.",
			installed_at: now(),
			updated_at: now(),
		},
	])
	.post("/api/v1/extensions/:extensionId/enable", ({ params, set }) =>
		extensionStatus(params.extensionId, set),
	)
	.post("/api/v1/extensions/:extensionId/disable", ({ params, set }) =>
		extensionStatus(params.extensionId, set),
	)
	.post("/api/v1/extensions/:extensionId/update", ({ params, set }) =>
		extensionStatus(params.extensionId, set),
	)
	.delete("/api/v1/extensions/:extensionId", ({ set }) =>
		fail(
			set,
			501,
			"PI_PACKAGE_MANAGEMENT_REQUIRED",
			"Packages are managed by Pi, not this HTTP API.",
		),
	)
	.get("/api/v1/mcp/servers", () => [])
	.get("/api/v1/mcp/servers/:serverId/tools", () => [])
	.post("/api/v1/mcp/servers/:serverId/reload", ({ set }) =>
		fail(
			set,
			501,
			"MCP_MANAGED_BY_PI",
			"Configure MCP through a Pi extension or project configuration.",
		),
	)
	.get("/api/v1/acp/adapters", () => [])
	.post("/api/v1/acp/adapters/:adapterId/probe", ({ set }) =>
		fail(
			set,
			501,
			"ACP_UNSUPPORTED",
			"Pi SDK does not expose ACP adapters through this harness.",
		),
	)
	.get("/api/v1/agent-modes", () => agentModes())
	.get("/api/v1/agents", () => agents())
	.put("/api/v1/agents/:agentId", ({ set }) =>
		fail(
			set,
			501,
			"PI_AGENT_CONFIGURATION_REQUIRED",
			"Configure agents through project .pi/agents files or Pi settings.",
		),
	)
	.put("/api/v1/agents/:agentId/runtime-binding", ({ set }) =>
		fail(
			set,
			501,
			"PI_AGENT_CONFIGURATION_REQUIRED",
			"Pi resolves agent models through its own configuration.",
		),
	)
	.put("/api/v1/agents/:agentId/mode", ({ set }) =>
		fail(
			set,
			501,
			"PI_AGENT_CONFIGURATION_REQUIRED",
			"Agent mode is configured by Pi agent definitions.",
		),
	)
	.get("/api/v1/agent-candidates", () => [])
	.get("/api/v1/agent-evolution/proposals", () => [])
	.post("/api/v1/agent-evolution/generate", () => [])
	.post("/api/v1/agent-evolution/proposals/:candidateId/promote", ({ set }) =>
		fail(set, 404, "CANDIDATE_NOT_FOUND", "No generated candidate exists."),
	)
	.post("/api/v1/agent-evolution/proposals/:candidateId/reject", ({ set }) =>
		fail(set, 404, "CANDIDATE_NOT_FOUND", "No generated candidate exists."),
	)
	.get("/api/v1/tools", () => tools())
	.get("/api/v1/tools/search", ({ query }) =>
		searchTools(stringValue(query.query)),
	)
	.get("/api/v1/harness/manifest", () => harnessManifest())
	.get("/api/v1/prompt-fragments", () => store.list("prompts"))
	.post("/api/v1/prompt-fragments", async ({ body, set }) => {
		const input = record(body);
		const prompt = {
			id: id("prompt"),
			key: stringOr(input.key, id("fragment")),
			title: stringOr(input.title, "Prompt fragment"),
			scope: stringOr(input.scope, "project"),
			target_agent_id: stringValue(input.target_agent_id),
			category: stringOr(input.category, "instruction"),
			content: stringOr(input.content, ""),
			priority: numberValue(input.priority, 0),
			enabled: input.enabled !== false,
			is_builtin: false,
			created_at: now(),
			updated_at: now(),
		};
		await store.upsert("prompts", prompt);
		set.status = 201;
		return prompt;
	})
	.put(
		"/api/v1/prompt-fragments/:fragmentId",
		async ({ params, body, set }) => {
			const existing = store.find("prompts", params.fragmentId);
			if (!existing)
				return fail(
					set,
					404,
					"PROMPT_FRAGMENT_NOT_FOUND",
					"Prompt fragment was not found.",
				);
			const updated = {
				...existing,
				...record(body),
				id: params.fragmentId,
				updated_at: now(),
				is_builtin: false,
			};
			await store.upsert("prompts", updated);
			return updated;
		},
	)
	.delete("/api/v1/prompt-fragments/:fragmentId", async ({ params, set }) =>
		(await store.remove("prompts", params.fragmentId))
			? null
			: fail(
					set,
					404,
					"PROMPT_FRAGMENT_NOT_FOUND",
					"Prompt fragment was not found.",
				),
	)
	.post(
		"/api/v1/prompt-fragments/:fragmentId/clone",
		async ({ params, set }) => {
			const original = store.find("prompts", params.fragmentId);
			if (!original)
				return fail(
					set,
					404,
					"PROMPT_FRAGMENT_NOT_FOUND",
					"Prompt fragment was not found.",
				);
			const clone = {
				...original,
				id: id("prompt"),
				key: `${String(original.key)}-copy`,
				title: `${String(original.title)} copy`,
				created_at: now(),
				updated_at: now(),
			};
			await store.upsert("prompts", clone);
			set.status = 201;
			return clone;
		},
	)
	.post("/api/v1/prompt-context/preview", ({ body }) => ({
		agent_id: stringOr(record(body).agent_id, "pi"),
		mode: stringOr(record(body).mode, "default"),
		fragments: store
			.list("prompts")
			.filter((fragment) => fragment.enabled !== false),
		context_pack_ids: [],
		estimated_tokens: 0,
		system_prompt:
			"Pi builds the effective system prompt from its resource loader, AGENTS.md files, skills, and configured extensions.",
		warnings: [],
	}))
	.all("/api/v1/*", ({ request, set }) =>
		fail(
			set,
			501,
			"PI_COMPATIBILITY_ROUTE_UNAVAILABLE",
			`The Pi core has not implemented ${request.method} for this compatibility route.`,
		),
	)
	.listen({ port, hostname: "127.0.0.1" });

console.log(`TinadecPi Core listening on http://127.0.0.1:${port}`);

function readiness(models: unknown[]) {
	const ready = models.length > 0;
	return {
		status: ready ? "ready" : "warning",
		generated_at: now(),
		runtime: "pi-agent-sdk",
		receipt_id: id("readiness"),
		components: [
			{
				id: "pi-sdk",
				name: "Pi Agent SDK",
				status: "ready",
				summary: "Embedded Node SDK runtime.",
				evidence: ["@earendil-works/pi-coding-agent"],
			},
			{
				id: "pi-subagents",
				name: "Pi Subagents",
				status: "ready",
				summary: "Delegation extension loaded for Pi sessions.",
				evidence: ["pi-subagents"],
			},
			{
				id: "models",
				name: "Pi models",
				status: ready ? "ready" : "warning",
				summary: ready
					? `${models.length} authenticated model(s) available.`
					: "No Pi model is authenticated.",
				evidence: ["pi /login or API key"],
			},
		],
		ready_count: ready ? 3 : 2,
		warning_count: ready ? 0 : 1,
		blocked_count: 0,
	};
}

function modelReadiness(
	models: Array<{ provider?: string; id?: string; name?: string }>,
) {
	return {
		status: models.length ? "ready" : "warning",
		generated_at: now(),
		receipt_id: id("model-readiness"),
		provider_count: models.length,
		ready_provider_count: models.length,
		warning_provider_count: models.length ? 0 : 1,
		blocked_provider_count: 0,
		route_count: 0,
		ready_route_count: 0,
		warning_route_count: 0,
		blocked_route_count: 0,
		providers: models.map((model) => ({
			provider_instance_id: `pi:${model.provider}`,
			display_name: model.name ?? model.id ?? "Pi model",
			driver: "pi",
			connection_kind: "pi",
			status: "ready",
			provider_status: "ready",
			enabled: true,
			has_credential: true,
			route_purposes: [],
			summary: "Resolved by Pi ModelRuntime.",
			evidence: [`${model.provider}/${model.id}`],
		})),
		routes: [],
		design_notes: [
			"Credentials remain in Pi auth storage and are never returned by TinadecPi.",
		],
	};
}

function modelCatalogReadiness(models: unknown[]) {
	return {
		status: models.length ? "ready" : "warning",
		generated_at: now(),
		receipt_id: id("catalog-readiness"),
		template_count: 1,
		ready_template_count: 1,
		warning_template_count: 0,
		blocked_template_count: 0,
		runtime_module_count: 1,
		configured_provider_count: models.length,
		advisory_probe_template_count: 0,
		templates: [
			{
				provider_family: "pi",
				driver: "pi",
				display_name: "Pi Agent",
				connection_kind: "pi",
				credential_kind: "pi-managed",
				status: "ready",
				runtime_module_family: "pi-agent-sdk",
				runtime_module_status: "ready",
				configured_instance_count: models.length,
				supports_live_discovery: true,
				live_discovery_policy: "Pi ModelRuntime only",
				summary: "Models are discovered from Pi configuration.",
				evidence: ["ModelRuntime.getAvailable"],
			},
		],
		design_notes: ["TinadecPi does not duplicate Pi provider configuration."],
	};
}

function toolReadiness() {
	const descriptors = tools();
	return {
		status: "ready",
		generated_at: now(),
		runtime: "pi-agent-sdk",
		receipt_id: id("tool-readiness"),
		tool_count: descriptors.length,
		ready_tool_count: descriptors.length,
		warning_tool_count: 0,
		blocked_tool_count: 0,
		execution_agent_count: 3,
		ready_agent_count: 3,
		warning_agent_count: 0,
		blocked_agent_count: 0,
		approval_gated_tool_count: 0,
		human_checkpoint_tool_count: 0,
		future_tool_count: 0,
		unresolved_scope_count: 0,
		tools: descriptors.map((tool) => ({
			tool_id: tool.id,
			display_name: tool.display_name,
			source: "pi",
			provider_layer: "pi-agent",
			risk: tool.risk,
			status: "ready",
			requires_approval: false,
			requires_human_checkpoint: false,
			is_future: false,
			assigned_execution_agent_count: 3,
			summary: "Pi built-in tool.",
			evidence: ["Pi SDK"],
		})),
		agent_scopes: agents().map((agent) => ({
			agent_id: agent.id,
			agent_name: agent.name,
			layer: agent.layer,
			agent_type: agent.agent_type,
			enabled: true,
			status: "ready",
			declared_scope_count: agent.allowed_tools.length,
			dispatchable_tool_count: agent.allowed_tools.length,
			internal_capability_count: 0,
			unresolved_scope_count: 0,
			approval_gated_tool_count: 0,
			tool_ids: agent.allowed_tools,
			unresolved_scopes: [],
			summary: "Managed by pi-subagents.",
			evidence: ["pi-subagents"],
		})),
		design_notes: ["Pi owns tool execution and extension lifecycles."],
	};
}

function piTemplate() {
	return {
		provider_family: "pi",
		driver: "pi",
		display_name: "Pi Agent Runtime",
		connection_kind: "pi",
		credential_kind: "pi-managed",
		summary: "Models, credentials, extensions, and skills configured by Pi.",
		contributor_description:
			"TinadecPi embeds Pi SDK without copying provider credentials.",
		default_base_url: null,
		default_model: null,
		default_timeout_seconds: 0,
		capabilities: {
			supports_streaming: true,
			supports_tools: true,
			supports_json_mode: false,
			supports_system_prompt: true,
			max_context_tokens: null,
			requires_workspace: true,
			credential_kind: "pi-managed",
			health_status: "unknown",
		},
	};
}

function providers(
	models: Array<{ provider?: string; id?: string; name?: string }>,
) {
	return models.map((model) => ({
		id: `pi:${model.provider}:${model.id}`,
		driver: "pi",
		display_name: model.name ?? model.id ?? "Pi model",
		connection_kind: "pi",
		base_url: null,
		model: model.id ?? null,
		has_api_key: true,
		binary_path: null,
		home_path: null,
		server_url: null,
		launch_args: null,
		capabilities: ["agent", "tools", "streaming", "subagents"],
		enabled: true,
		status: "ready",
		status_message: "Resolved by Pi ModelRuntime.",
		cooldown_until: null,
		created_at: now(),
		updated_at: now(),
	}));
}

function agents() {
	return [
		{
			id: "pi-planner",
			name: "Planner",
			layer: "planning",
			agent_type: "planner",
			mode: "parallel",
			description: "Pi subagent planning role.",
			model_route_purpose: "pi",
			allowed_tools: ["read", "grep", "find", "ls"],
			capabilities: ["subagent"],
			system_prompt: null,
			enabled: true,
			is_built_in: true,
			updated_at: now(),
		},
		{
			id: "pi-worker",
			name: "Worker",
			layer: "execution",
			agent_type: "worker",
			mode: "parallel",
			description: "Pi subagent implementation role.",
			model_route_purpose: "pi",
			allowed_tools: ["read", "bash", "edit", "write"],
			capabilities: ["subagent"],
			system_prompt: null,
			enabled: true,
			is_built_in: true,
			updated_at: now(),
		},
		{
			id: "pi-reviewer",
			name: "Reviewer",
			layer: "planning",
			agent_type: "reviewer",
			mode: "parallel",
			description: "Pi subagent review role.",
			model_route_purpose: "pi",
			allowed_tools: ["read", "grep", "find", "ls"],
			capabilities: ["subagent"],
			system_prompt: null,
			enabled: true,
			is_built_in: true,
			updated_at: now(),
		},
	];
}

function agentModes() {
	return [
		{
			id: "default",
			display_name: "Pi default",
			summary: "Single Pi session.",
			max_parallel_executors: 1,
			worktree_isolation: false,
			approval_required: false,
			budget_policy: "Pi runtime settings",
		},
		{
			id: "parallel",
			display_name: "Pi subagents",
			summary:
				"pi-subagents supports focused child sessions, chains, and parallel reviews.",
			max_parallel_executors: 4,
			worktree_isolation: true,
			approval_required: false,
			budget_policy: "pi-subagents runtime settings",
		},
	];
}

function tools() {
	return [
		"read",
		"grep",
		"find",
		"ls",
		"bash",
		"edit",
		"write",
		"subagent",
	].map((tool) => ({
		id: tool,
		display_name: tool,
		domain: tool === "subagent" ? "agent" : "code",
		source: tool === "subagent" ? "extension" : "builtin",
		risk: ["bash", "edit", "write"].includes(tool) ? "medium" : "low",
		requires_approval: false,
		execute_endpoint: "/api/v1/sessions/:sessionId/messages",
		capabilities: [`pi.${tool}`],
	}));
}

function searchTools(query?: string) {
	const normalized = query?.toLowerCase() ?? "";
	return tools()
		.filter(
			(tool) =>
				!normalized ||
				tool.id.includes(normalized) ||
				tool.display_name.includes(normalized),
		)
		.map((tool) => ({
			tool,
			score: 1,
			matched_fields: normalized ? ["id"] : [],
			provider_layer: "pi-agent",
			requires_human_checkpoint: false,
			approval_summary: "",
		}));
}

function harnessManifest() {
	return {
		runtime: "pi-agent-sdk",
		ownership_model:
			"Pi owns agent runtime, credentials, tools, skills, extensions, session compaction, and child-agent orchestration.",
		tool_registry: {
			declared_tool_count: tools().length,
			canonical_tool_count: tools().length,
			duplicate_tool_id_count: 0,
			duplicate_tool_ids: [],
			source_precedence: [
				"Pi SDK",
				"pi-subagents",
				"trusted project extensions",
			],
			selection_policy: "Pi resource loader",
		},
		agent_layers: [
			{
				layer: "planning",
				role: "plan and review",
				agent_count: 2,
				enabled_agent_count: 2,
				max_parallel_executors: 4,
				worktree_isolation: true,
				approval_required: false,
				agent_types: ["planner", "reviewer"],
				tool_ids: ["read", "grep", "find", "ls"],
			},
			{
				layer: "execution",
				role: "implement",
				agent_count: 1,
				enabled_agent_count: 1,
				max_parallel_executors: 4,
				worktree_isolation: true,
				approval_required: false,
				agent_types: ["worker"],
				tool_ids: ["read", "bash", "edit", "write"],
			},
		],
		tool_providers: [
			{
				source: "pi-sdk",
				display_name: "Pi Agent SDK",
				layer: "runtime",
				status: "ready",
				tool_count: 7,
				active_tool_count: 7,
				future_tool_count: 0,
				approval_required_count: 0,
				read_only_count: 4,
				capability_prefixes: ["pi."],
			},
			{
				source: "pi-subagents",
				display_name: "Pi Subagents",
				layer: "orchestration",
				status: "ready",
				tool_count: 1,
				active_tool_count: 1,
				future_tool_count: 0,
				approval_required_count: 0,
				read_only_count: 0,
				capability_prefixes: ["subagent"],
			},
		],
		tool_risks: [],
		tools: tools(),
		design_notes: [
			"Gateway API contracts remain stable.",
			"TinadecPi embeds Pi SDK in-process.",
			"Multi-agent delegation is provided by pi-subagents, not a duplicated orchestrator.",
		],
	};
}

function orchestration() {
	return {
		run: null,
		graph: null,
		nodes: [],
		assignments: [],
		step_results: [],
		context_packs: [],
		supervision_findings: [],
	};
}

function extensionStatus(
	extensionId: string,
	set: { status?: number | string },
) {
	if (extensionId !== "pi-subagents")
		return fail(set, 404, "EXTENSION_NOT_FOUND", "Extension was not found.");
	return {
		id: "pi-subagents",
		extension_id: "pi-subagents",
		enabled: true,
		status: "ready",
		status_message: "Managed by the TinadecPi installation.",
	};
}

async function queuePi(
	set: { status?: number | string },
	raw: unknown,
	action: (content: string) => Promise<void>,
) {
	const content = stringOr(raw, "");
	if (!content)
		return fail(set, 400, "MESSAGE_EMPTY", "Message content is required.");
	try {
		await action(content);
		return { status: "queued" };
	} catch (error) {
		return fail(set, 409, "PI_QUEUE_FAILED", safeError(error));
	}
}

function eventStream(
	sessionId: string | undefined,
	signal: AbortSignal,
): Response {
	return sse(
		(send) =>
			new Promise<void>((resolve) => {
				for (const event of store.listEvents(sessionId).slice(-50)) send(event);
				const unsubscribe = store.subscribe((event) => {
					if (!sessionId || event.session_id === sessionId) send(event);
				});
				signal.addEventListener(
					"abort",
					() => {
						unsubscribe();
						resolve();
					},
					{ once: true },
				);
			}),
	);
}

function sse(
	work: (send: (value: Record<string, unknown>) => void) => Promise<void>,
): Response {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream({
			async start(controller) {
				const send = (value: Record<string, unknown>) =>
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
					);
				try {
					await work(send);
				} catch (error) {
					send({ kind: "error", safe_error_message: safeError(error) });
				} finally {
					controller.close();
				}
			},
		}),
		{
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			},
		},
	);
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberValue(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function fail(
	set: { status?: number | string },
	status: number,
	code: string,
	message: string,
) {
	set.status = status;
	return { code, message };
}
function safeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
