const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
	deletePiModel,
	listPiModelConfigs,
	savePiModel,
} = require("./piModelConfig.cjs");

let agentDir;
let previousAgentDir;

test.before(() => {
	previousAgentDir = process.env.TINADEC_PI_AGENT_DIR;
	agentDir = mkdtempSync(path.join(os.tmpdir(), "tinadec-pi-model-"));
	process.env.TINADEC_PI_AGENT_DIR = agentDir;
});

test.after(() => {
	if (previousAgentDir === undefined) delete process.env.TINADEC_PI_AGENT_DIR;
	else process.env.TINADEC_PI_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, {
		recursive: true,
		force: true,
		maxRetries: 3,
		retryDelay: 50,
	});
});

test("stores built-in provider credentials in the isolated Pi agent directory", async () => {
	const saved = await savePiModel({
		kind: "builtin",
		provider: "openai",
		apiKey: "test-key",
	});

	assert.deepEqual(saved, { provider: "openai", modelId: null });
	const auth = JSON.parse(
		readFileSync(path.join(agentDir, "auth.json"), "utf8"),
	);
	assert.deepEqual(auth.openai, { type: "api_key", key: "test-key" });
});

test("stores a custom model without putting the API key in models.json", async () => {
	const saved = await savePiModel({
		kind: "custom",
		provider: "local-llm",
		apiKey: "test-key",
		baseUrl: "https://models.example.test/v1/",
		modelId: "local-chat",
		displayName: "Local chat",
		api: "openai-completions",
	});

	assert.deepEqual(saved, { provider: "local-llm", modelId: "local-chat" });
	const models = JSON.parse(
		readFileSync(path.join(agentDir, "models.json"), "utf8"),
	);
	assert.deepEqual(models.providers["local-llm"], {
		baseUrl: "https://models.example.test/v1",
		api: "openai-completions",
		models: [{ id: "local-chat", name: "Local chat", reasoning: false }],
	});
	assert.doesNotMatch(JSON.stringify(models), /test-key/);

	const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
	const runtime = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
	});
	assert.ok(runtime.getModel("local-llm", "local-chat"));
});

test("edits and deletes only the selected isolated custom model", async () => {
	await savePiModel({
		kind: "custom",
		provider: "local-llm",
		apiKey: "test-key",
		baseUrl: "https://models.example.test/v1",
		modelId: "second-model",
		displayName: "Second model",
		api: "openai-completions",
		reasoning: true,
	});
	await savePiModel({
		kind: "custom",
		provider: "local-llm",
		baseUrl: "https://models.example.test/v2",
		modelId: "renamed-chat",
		previousModelId: "local-chat",
		displayName: "Renamed chat",
		api: "openai-responses",
		reasoning: true,
		update: true,
	});

	assert.deepEqual(listPiModelConfigs(), [
		{
			kind: "custom",
			provider: "local-llm",
			modelId: "second-model",
			displayName: "Second model",
			baseUrl: "https://models.example.test/v2",
			api: "openai-responses",
			reasoning: true,
		},
		{
			kind: "custom",
			provider: "local-llm",
			modelId: "renamed-chat",
			displayName: "Renamed chat",
			baseUrl: "https://models.example.test/v2",
			api: "openai-responses",
			reasoning: true,
		},
	]);
	await deletePiModel({ provider: "local-llm", modelId: "renamed-chat" });
	assert.deepEqual(
		listPiModelConfigs().map((model) => model.modelId),
		["second-model"],
	);
	await deletePiModel({ provider: "local-llm", modelId: "second-model" });
	assert.deepEqual(listPiModelConfigs(), []);
	const auth = JSON.parse(
		readFileSync(path.join(agentDir, "auth.json"), "utf8"),
	);
	assert.equal(auth["local-llm"], undefined);
});
