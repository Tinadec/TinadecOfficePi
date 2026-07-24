import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore } from "./store.js";

async function newStore(
	t: test.TestContext,
): Promise<{ file: string; store: CoreStore; directory: string }> {
	const directory = await mkdtemp(join(tmpdir(), "tinadec-pi-store-"));
	t.after(() =>
		rm(directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		}),
	);
	const file = join(directory, "state.json");
	const store = new CoreStore(file);
	await store.load();
	return { directory, file, store };
}

test("CoreStore persists concurrent Pi messages", async (t) => {
	const { directory, file, store } = await newStore(t);
	const project = await store.createProject("Example", directory);
	const session = await store.createSession(project.id, "Pi run");
	await Promise.all([
		store.addMessage(session.id, "user", "Concurrent message one."),
		store.addMessage(session.id, "user", "Concurrent message two."),
	]);

	const restored = new CoreStore(file);
	await restored.load();
	assert.equal(restored.listProjects()[0]?.id, project.id);
	assert.equal(restored.listSessions(project.id)[0]?.id, session.id);
	assert.deepEqual(
		restored
			.listMessages(session.id)
			.map((message) => message.content)
			.sort(),
		["Concurrent message one.", "Concurrent message two."],
	);
});

test("CoreStore persists Pi run projections", async (t) => {
	const { directory, file, store } = await newStore(t);
	const project = await store.createProject("Example", directory);
	const session = await store.createSession(project.id, "Pi run");
	const run = await store.createRun(session.id, "pair", "Paired Pi delegation");
	const createdAt = new Date().toISOString();
	await store.upsertToolExecution({
		id: "tool-call",
		run_id: run.id,
		session_id: session.id,
		tool_id: "subagent",
		tool_display_name: "Subagent",
		source: "pi",
		provider_layer: "pi-agent-sdk",
		risk: "unknown",
		requires_approval: false,
		status: "completed",
		summary: "Two child agents completed.",
		evidence: [],
		requested_at: createdAt,
		updated_at: createdAt,
		duration_ms: 10,
		requested_seq: 1,
		updated_seq: 2,
		event_types: ["tool_execution_start", "tool_execution_end"],
		checkpoint_summary: "Completed",
	});
	await store.upsertAgentExecution({
		id: `${run.id}:scout`,
		run_id: run.id,
		session_id: session.id,
		agent_id: "scout",
		agent_name: "scout",
		agent_type: "scout",
		status: "completed",
		task: "Inspect the request",
		created_at: createdAt,
		updated_at: createdAt,
	});
	await store.updateRun(run.id, { status: "completed" });

	const restored = new CoreStore(file);
	await restored.load();
	assert.equal(restored.listRuns(session.id)[0]?.status, "completed");
	assert.equal(restored.listToolExecutions(session.id)[0]?.tool_id, "subagent");
	assert.equal(restored.listAgentExecutions(run.id)[0]?.agent_type, "scout");
});

test("CoreStore persists approval events", async (t) => {
	const { directory, file, store } = await newStore(t);
	const project = await store.createProject("Example", directory);
	const session = await store.createSession(project.id, "Pi run");
	const approval = await store.createApproval({
		session_id: session.id,
		kind: "tool",
		summary: "Write a file",
	});
	await store.decideApproval(approval.id as string, "approved");
	await store.publish(
		"approval.approved",
		session.id,
		{ approval_id: approval.id as string },
		["approval.decide"],
	);

	const restored = new CoreStore(file);
	await restored.load();
	assert.equal(restored.listApprovals(session.id)[0]?.status, "approved");
	assert.equal(restored.listEvents(session.id)[0]?.type, "approval.approved");
});
