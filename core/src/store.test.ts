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
	t.after(() => rm(directory, { recursive: true, force: true }));
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
