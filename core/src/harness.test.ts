import assert from "node:assert/strict";
import test from "node:test";
import { PiHarness, lastAssistantResult } from "./harness.js";

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

test("PiHarness serializes concurrent work for one session", async () => {
	const harness = new PiHarness({} as never);
	const enqueue = (harness as unknown as {
		enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T>;
	}).enqueue.bind(harness);
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
