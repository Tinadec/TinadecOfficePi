import assert from "node:assert/strict";
import test from "node:test";
import { lastAssistantResult } from "./harness.js";

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
