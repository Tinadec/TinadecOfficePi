const {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const BUILTIN_PROVIDERS = new Set([
	"openai",
	"anthropic",
	"google",
	"openrouter",
	"deepseek",
	"xai",
	"groq",
	"mistral",
]);
const CUSTOM_APIS = new Set([
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
]);

function projectRoot() {
	return path.resolve(__dirname, "..", "..", "..");
}

function piModelPaths(root = projectRoot()) {
	const agentDir =
		process.env.TINADEC_PI_AGENT_DIR ??
		path.join(root, "core", ".tinadec-pi", "pi-agent");
	return {
		agentDir,
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: path.join(agentDir, "models.json"),
		authStorageModule: path.join(
			root,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"core",
			"auth-storage.js",
		),
	};
}

function requiredString(value, label, max = 2048) {
	if (typeof value !== "string") throw new Error(`${label} is required.`);
	const normalized = value.trim();
	if (!normalized || normalized.length > max)
		throw new Error(`${label} is invalid.`);
	return normalized;
}

function optionalString(value, max = 2048) {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized && normalized.length <= max ? normalized : undefined;
}

function customProviderId(value) {
	const id = requiredString(value, "Provider id", 64).toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
		throw new Error(
			"Provider id may contain only lowercase letters, numbers, and hyphens.",
		);
	}
	return id;
}

function normalizeBaseUrl(value) {
	const url = new URL(requiredString(value, "Base URL"));
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new Error("Base URL must use HTTP or HTTPS.");
	}
	return url.toString().replace(/\/$/, "");
}

function readModelsConfig(modelsPath) {
	if (!existsSync(modelsPath)) return {};
	try {
		const value = JSON.parse(readFileSync(modelsPath, "utf8"));
		if (!value || Array.isArray(value) || typeof value !== "object") {
			throw new Error("models.json must contain an object.");
		}
		return value;
	} catch (error) {
		throw new Error(`Unable to read Pi models.json: ${error.message}`);
	}
}

function writeJsonAtomically(file, value) {
	const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	renameSync(temp, file);
}

function saveCustomModel(modelsPath, input, providerId) {
	const config = readModelsConfig(modelsPath);
	const providers =
		config.providers &&
		typeof config.providers === "object" &&
		!Array.isArray(config.providers)
			? config.providers
			: {};
	const existing =
		providers[providerId] &&
		typeof providers[providerId] === "object" &&
		!Array.isArray(providers[providerId])
			? providers[providerId]
			: {};
	const modelId = requiredString(input.modelId, "Model id", 200);
	const previousModelId = optionalString(input.previousModelId, 200);
	const previous = Array.isArray(existing.models)
		? existing.models.find(
				(model) => model?.id === (previousModelId ?? modelId),
			)
		: undefined;
	const replacedIds = new Set([modelId, previousModelId].filter(Boolean));
	const models = Array.isArray(existing.models)
		? existing.models.filter((model) => !replacedIds.has(model?.id))
		: [];
	models.push({
		id: modelId,
		...(typeof input.displayName === "string" && input.displayName.trim()
			? { name: input.displayName.trim().slice(0, 100) }
			: {}),
		reasoning:
			typeof input.reasoning === "boolean"
				? input.reasoning
				: previous?.reasoning === true,
	});
	providers[providerId] = {
		...existing,
		baseUrl: normalizeBaseUrl(input.baseUrl),
		api: CUSTOM_APIS.has(input.api) ? input.api : "openai-completions",
		models,
	};
	writeJsonAtomically(modelsPath, { ...config, providers });
	return modelId;
}

async function savePiModel(input) {
	const kind = input?.kind === "custom" ? "custom" : "builtin";
	const provider =
		kind === "custom"
			? customProviderId(input.provider)
			: requiredString(input?.provider, "Provider", 64);
	if (kind === "builtin" && !BUILTIN_PROVIDERS.has(provider)) {
		throw new Error("Unsupported Pi provider.");
	}
	const apiKey = optionalString(input?.apiKey, 4096);
	const paths = piModelPaths();
	mkdirSync(paths.agentDir, { recursive: true, mode: 0o700 });

	const { AuthStorage } = await import(
		pathToFileURL(paths.authStorageModule).href
	);
	const storage = AuthStorage.create(paths.authPath);
	if (apiKey) {
		await storage.modify(provider, async () => ({
			type: "api_key",
			key: apiKey,
		}));
	} else if (input?.update !== true) {
		throw new Error("API key is required when adding a model.");
	} else if (
		!(await storage.list()).some((entry) => entry.providerId === provider)
	) {
		throw new Error("Enter an API key for this provider.");
	}
	const modelId =
		kind === "custom"
			? saveCustomModel(paths.modelsPath, input, provider)
			: null;

	return { provider, modelId };
}

function listPiModelConfigs() {
	const { modelsPath } = piModelPaths();
	const config = readModelsConfig(modelsPath);
	const providers =
		config.providers &&
		typeof config.providers === "object" &&
		!Array.isArray(config.providers)
			? config.providers
			: {};
	return Object.entries(providers).flatMap(([provider, definition]) => {
		if (
			BUILTIN_PROVIDERS.has(provider) ||
			!definition ||
			typeof definition !== "object"
		) {
			return [];
		}
		const models = Array.isArray(definition.models) ? definition.models : [];
		return models.flatMap((model) => {
			if (!model || typeof model !== "object" || typeof model.id !== "string")
				return [];
			return [
				{
					kind: "custom",
					provider,
					modelId: model.id,
					displayName: typeof model.name === "string" ? model.name : "",
					baseUrl:
						typeof definition.baseUrl === "string" ? definition.baseUrl : "",
					api: CUSTOM_APIS.has(definition.api)
						? definition.api
						: "openai-completions",
					reasoning: model.reasoning === true,
				},
			];
		});
	});
}

async function deletePiModel(input) {
	const provider = customProviderId(input?.provider);
	const modelId = requiredString(input?.modelId, "Model id", 200);
	const paths = piModelPaths();
	const config = readModelsConfig(paths.modelsPath);
	const providers =
		config.providers &&
		typeof config.providers === "object" &&
		!Array.isArray(config.providers)
			? config.providers
			: {};
	const definition = providers[provider];
	if (
		!definition ||
		typeof definition !== "object" ||
		!Array.isArray(definition.models)
	) {
		throw new Error("Custom Pi model was not found.");
	}
	const models = definition.models.filter((model) => model?.id !== modelId);
	if (models.length === definition.models.length) {
		throw new Error("Custom Pi model was not found.");
	}
	if (models.length > 0) providers[provider] = { ...definition, models };
	else delete providers[provider];
	writeJsonAtomically(paths.modelsPath, { ...config, providers });
	if (models.length === 0) {
		const { AuthStorage } = await import(
			pathToFileURL(paths.authStorageModule).href
		);
		await AuthStorage.create(paths.authPath).delete(provider);
	}
	return { provider, modelId };
}

module.exports = {
	deletePiModel,
	listPiModelConfigs,
	piModelPaths,
	savePiModel,
};
