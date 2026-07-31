const { closeSync, existsSync, mkdirSync, openSync } = require("node:fs");
const { delimiter, join } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:48730";
const CORE_URL = "http://127.0.0.1:48731";
const SERVICE_VERSION = "0.1.0";

function bundledRuntimePaths(resourcesPath, platform = process.platform) {
	const root = join(resourcesPath, "runtime");
	const nodeDir = join(root, "node");
	const toolsDir = join(root, "tools");
	return {
		node: join(nodeDir, platform === "win32" ? "node.exe" : "node"),
		nodeDir,
		core: join(root, "services", "TinadecPi", "index.js"),
		gateway: join(root, "services", "gateway", "index.js"),
		services: join(root, "services"),
		tools: join(
			toolsDir,
			platform === "win32" ? "TinadecTools.exe" : "TinadecTools",
		),
		toolsDir,
	};
}

function shouldStartBundledServices(isPackaged, gatewayUrl) {
	if (!isPackaged) return false;
	try {
		const url = new URL(gatewayUrl);
		return (
			url.protocol === "http:" &&
			url.hostname === "127.0.0.1" &&
			url.port === "48730" &&
			(url.pathname === "/" || url.pathname === "") &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}

function matchesServiceIdentity(service, health) {
	if (!health || typeof health !== "object" || Array.isArray(health)) {
		return false;
	}
	if (
		health.name !== "Tinadec Pi" ||
		health.status !== "ok" ||
		health.version !== SERVICE_VERSION ||
		health.runtime !== "pi-agent-sdk"
	) {
		return false;
	}
	if (service === "gateway") {
		return health.gateway === "ok" && health.core_url === CORE_URL;
	}
	return service === "core";
}

async function probeService(
	url,
	service,
	{ fetchImpl = globalThis.fetch, timeoutMs = 800 } = {},
) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(url, { signal: controller.signal });
		let health;
		try {
			health = await response.json();
		} catch {
			return { status: "mismatch" };
		}
		return response.ok && matchesServiceIdentity(service, health)
			? { status: "ready" }
			: { status: "mismatch" };
	} catch {
		return { status: "unavailable" };
	} finally {
		clearTimeout(timeout);
	}
}

function buildServiceEnvironment(
	paths,
	env,
	platform = process.platform,
) {
	const result = { ...env };
	const pathKey =
		platform === "win32"
			? Object.keys(result).find((key) => key.toLowerCase() === "path") ??
				"PATH"
			: "PATH";
	const separator = platform === process.platform ? delimiter : platform === "win32" ? ";" : ":";
	result[pathKey] = [paths.nodeDir, paths.toolsDir, result[pathKey]]
		.filter(Boolean)
		.join(separator);
	return result;
}

function createServiceManager({
	platform = process.platform,
	fetchImpl = globalThis.fetch,
	spawnImpl = spawn,
	spawnSyncImpl = spawnSync,
} = {}) {
	const ownedChildren = new Map();
	const logFds = new Map();
	let stopping;

	function closeLog(child) {
		const logFd = logFds.get(child);
		if (logFd === undefined) return;
		logFds.delete(child);
		try {
			closeSync(logFd);
		} catch {
			// The child close event may race explicit shutdown.
		}
	}

	function startProcess(label, command, args, cwd, env, logsDir) {
		const logFd = openSync(join(logsDir, `${label}.log`), "a");
		let child;
		try {
			child = spawnImpl(command, args, {
				cwd,
				env,
				detached: false,
				windowsHide: true,
				stdio: ["ignore", logFd, logFd],
			});
		} catch (error) {
			closeSync(logFd);
			throw error;
		}

		child.startupError = null;
		logFds.set(child, logFd);
		ownedChildren.set(label, child);
		child.once("error", (error) => {
			child.startupError = error;
		});
		child.once("close", () => {
			if (ownedChildren.get(label) === child) ownedChildren.delete(label);
			closeLog(child);
		});
		return child;
	}

	async function waitForService(
		url,
		service,
		child,
		label,
		timeoutMs = 30_000,
	) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const probe = await probeService(url, service, { fetchImpl });
			if (probe.status === "ready") return;
			if (probe.status === "mismatch") {
				throw new Error(
					`${label} endpoint at ${url} is occupied by an unexpected service or version.`,
				);
			}
			if (child?.startupError) throw child.startupError;
			if (child && child.exitCode !== null) {
				throw new Error(
					`${label} exited with code ${child.exitCode}. See the service log for details.`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(
			`${label} did not become ready within ${timeoutMs / 1000} seconds.`,
		);
	}

	function waitForExit(child, timeoutMs) {
		if (child.exitCode !== null || child.signalCode != null) {
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			const onClose = () => finish(true);
			const timeout = setTimeout(() => finish(false), timeoutMs);
			function finish(exited) {
				clearTimeout(timeout);
				child.removeListener("close", onClose);
				resolve(exited);
			}
			child.once("close", onClose);
		});
	}

	async function terminateChild(child) {
		if (!child.pid || child.exitCode !== null || child.signalCode != null) return;
		if (platform === "win32") {
			spawnSyncImpl("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
				stdio: "ignore",
				windowsHide: true,
			});
			return;
		}

		try {
			child.kill("SIGTERM");
		} catch {
			return;
		}
		if (await waitForExit(child, 3_000)) return;
		try {
			child.kill("SIGKILL");
		} catch {
			return;
		}
		await waitForExit(child, 1_000);
	}

	async function stopBundledServices() {
		if (stopping) return stopping;
		stopping = (async () => {
			const children = [...ownedChildren.values()].reverse();
			ownedChildren.clear();
			for (const child of children) {
				await terminateChild(child);
				closeLog(child);
			}
			for (const child of [...logFds.keys()]) closeLog(child);
		})().finally(() => {
			stopping = undefined;
		});
		return stopping;
	}

	async function startBundledServices({
		isPackaged,
		gatewayUrl,
		resourcesPath,
		userDataPath,
	}) {
		if (!shouldStartBundledServices(isPackaged, gatewayUrl)) {
			return { started: false, ownsCore: false };
		}
		if (stopping) await stopping;
		if (!resourcesPath) {
			throw new Error("Electron resources path is unavailable.");
		}

		const paths = bundledRuntimePaths(resourcesPath, platform);
		for (const name of ["node", "core", "gateway", "tools"]) {
			if (!existsSync(paths[name])) {
				throw new Error(`Bundled ${name} runtime is missing: ${paths[name]}`);
			}
		}
		if (!userDataPath) {
			throw new Error("Electron user data path is unavailable.");
		}

		const dataRoot = join(userDataPath, "runtime");
		const logsDir = join(dataRoot, "logs");
		const agentDir = join(userDataPath, "pi-agent");
		mkdirSync(logsDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		process.env.TINADEC_PI_AGENT_DIR = agentDir;
		const baseEnv = buildServiceEnvironment(paths, process.env, platform);

		let started = false;
		try {
			const coreUrl = `${CORE_URL}/api/v1/health`;
			const coreProbe = await probeService(coreUrl, "core", { fetchImpl });
			if (coreProbe.status === "mismatch") {
				throw new Error(
					`TinadecPi Core endpoint at ${coreUrl} is occupied by an unexpected service or version.`,
				);
			}
			if (coreProbe.status !== "ready") {
				const core = startProcess(
					"core",
					paths.node,
					[paths.core],
					paths.services,
					{
						...baseEnv,
						NODE_ENV: "production",
						TINADEC_CORE_PORT: "48731",
						TINADEC_DATA_DIR: join(dataRoot, "core"),
						TINADEC_PI_AGENT_DIR: agentDir,
					},
					logsDir,
				);
				started = true;
				await waitForService(coreUrl, "core", core, "TinadecPi Core");
			}

			const gatewayHealthUrl = `${DEFAULT_GATEWAY_URL}/api/v1/health`;
			const gatewayProbe = await probeService(gatewayHealthUrl, "gateway", {
				fetchImpl,
			});
			if (gatewayProbe.status === "mismatch") {
				throw new Error(
					`TinadecOffice Gateway endpoint at ${gatewayHealthUrl} is occupied by an unexpected service or version.`,
				);
			}
			if (gatewayProbe.status !== "ready") {
				const gateway = startProcess(
					"gateway",
					paths.node,
					[paths.gateway],
					paths.services,
					{
						...baseEnv,
						NODE_ENV: "production",
						TINADEC_GATEWAY_PORT: "48730",
						TINADEC_CORE_URL: CORE_URL,
						TINADEC_TOOLS_BIN: paths.tools,
					},
					logsDir,
				);
				started = true;
				await waitForService(
					gatewayHealthUrl,
					"gateway",
					gateway,
					"TinadecOffice Gateway",
				);
			}

			return {
				started: started || ownedChildren.size > 0,
				ownsCore: ownedChildren.has("core"),
			};
		} catch (error) {
			await stopBundledServices();
			throw error;
		}
	}

	return {
		ownedServiceLabels: () => [...ownedChildren.keys()],
		startBundledServices,
		stopBundledServices,
	};
}

const serviceManager = createServiceManager();

module.exports = {
	CORE_URL,
	DEFAULT_GATEWAY_URL,
	SERVICE_VERSION,
	buildServiceEnvironment,
	bundledRuntimePaths,
	createServiceManager,
	matchesServiceIdentity,
	probeService,
	shouldStartBundledServices,
	startBundledServices: serviceManager.startBundledServices,
	stopBundledServices: serviceManager.stopBundledServices,
};
