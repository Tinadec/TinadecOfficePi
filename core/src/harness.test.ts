import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
	PiHarness,
	isIsolatedSessionFile,
	isSubagentExecution,
	lastAssistantResult,
	promptForMode,
	resolveAgentDir,
	resolveIsolatedTempDir,
	subagentNames,
} from "./harness.js";

test("resolveAgentDir stays inside the project unless explicitly configured", () => {
	assert.equal(
		resolveAgentDir(undefined, "D:/work/TinadecPi/core"),
		join("D:/work/TinadecPi/core", ".tinadec-pi", "pi-agent"),
	);
	assert.equal(
		resolveAgentDir("D:/isolated/pi", "D:/work/TinadecPi/core"),
		"D:/isolated/pi",
	);
	assert.equal(
		resolveIsolatedTempDir("D:/isolated/pi"),
		join("D:/isolated/pi", "tmp"),
	);
});

test("only resumes Pi sessions from the isolated agent directory", () => {
	const agentDir = "D:/work/TinadecPi/core/.tinadec-pi/pi-agent";
	assert.equal(
		isIsolatedSessionFile(`${agentDir}/sessions/current.jsonl`, agentDir),
		true,
	);
	assert.equal(
		isIsolatedSessionFile(
			"C:/Users/example/.pi/agent/sessions/legacy.jsonl",
			agentDir,
		),
		false,
	);
});

test("lastAssistantResult reports a failed response instead of an earlier answer", () => {
	const messages = [
		{ role: "assistant", content: [{ type: "text", text: "TinadecPi ready" }] },
		{
			role: "assistant",
			content: [],
			errorMessage: "OpenAI API error (502): unavailable",
		},
	];

	assert.deepEqual(lastAssistantResult(messages.slice(1)), {
		error: "OpenAI API error (502): unavailable",
	});
});

test("each Pi run mode produces a distinct execution contract", () => {
	assert.match(promptForMode("ship it", "plan"), /planning agent/);
	assert.match(promptForMode("ship it", "spec"), /specification agent/);
	assert.match(
		promptForMode("ship it", "auto"),
		/Choose the smallest correct response/,
	);
	assert.match(
		promptForMode("ship it", "pair"),
		/exactly two parallel, read-only tasks/,
	);
	assert.match(
		promptForMode("ship it", "space"),
		/space\.full_duplex/,
	);
});

test("subagentNames recognizes every supported delegation shape", () => {
	assert.deepEqual(
		subagentNames({
			agent: "meeting",
			tasks: [{ agent: "planner" }],
			chain: [
				{ agent: "worker" },
				{ parallel: [{ agent: "supervisor" }] },
			],
		}),
		["meeting", "planner", "worker", "supervisor"],
	);
});

test("isSubagentExecution ignores management actions", () => {
	assert.equal(isSubagentExecution({ agent: "scout" }), true);
	assert.equal(isSubagentExecution({ tasks: [{ agent: "reviewer" }] }), true);
	assert.equal(isSubagentExecution({ action: "list" }), false);
	assert.equal(isSubagentExecution({ action: "status", id: "x" }), false);
});

test("PiHarness serializes concurrent work for one session", async () => {
	const harness = new PiHarness({} as never);
	const enqueue = (
		harness as unknown as {
			enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T>;
		}
	).enqueue.bind(harness);
	const order: string[] = [];
	let release!: () => void;
	const firstFinished = new Promise<void>((resolve) => {
		release = resolve;
	});

	const first = enqueue("session", async () => {
		order.push("first-start");
		await firstFinished;
		order.push("first-end");
	});
	const second = enqueue("session", async () => {
		order.push("second-start");
	});

	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(order, ["first-start"]);
	release();
	await Promise.all([first, second]);
	assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
});
