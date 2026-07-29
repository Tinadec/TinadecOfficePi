const { closeSync, existsSync, mkdirSync, openSync } = require("node:fs");
const { join } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:48730";
const CORE_URL = "http://127.0.0.1:48731";
const children = [];
const logFds = new Set();

function bundledRuntimePaths(resourcesPath, platform = process.platform) {
	const root = join(resourcesPath, "runtime");
	return {
		bun: join(root, "bun", platform === "win32" ? "bun.exe" : "bun"),
		core: join(root, "services", "TinadecPi", "index.js"),
		gateway: join(root, "services", "gateway", "index.js"),
		services: join(root, "services"),
		tools: join(
			root,
			"tools",
			platform === "win32" ? "TinadecTools.exe" : "TinadecTools",
		),
	};
}

function shouldStartBundledServices(isPackaged, gatewayUrl) {
	if (!isPackaged) return false;
	try {
		const url = new URL(gatewayUrl);
		return (
			url.protocol === "http:" &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.port === "48730" &&
			(url.pathname === "/" || url.pathname === "")
		);
	} catch {
		return false;
	}
}

async function reachable(url) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 800);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

function startProcess(label, command, args, cwd, env, logsDir) {
	const logFd = openSync(join(logsDir, `${label}.log`), "a");
	logFds.add(logFd);
	try {
		const child = spawn(command, args, {
			cwd,
			env,
			detached: false,
			windowsHide: true,
			stdio: ["ignore", logFd, logFd],
		});
		child.startupError = null;
		child.once("error", (error) => {
			child.startupError = error;
		});
		child.once("close", () => {
			if (logFds.delete(logFd)) closeSync(logFd);
		});
		children.push(child);
		return child;
	} catch (error) {
		logFds.delete(logFd);
		closeSync(logFd);
		throw error;
	}
}

async function waitForService(url, child, label, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await reachable(url)) return;
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

async function startBundledServices({
	isPackaged,
	gatewayUrl,
	resourcesPath,
	userDataPath,
}) {
	if (!shouldStartBundledServices(isPackaged, gatewayUrl))
		return { started: false, ownsCore: false };

	const paths = bundledRuntimePaths(resourcesPath);
	for (const [name, path] of Object.entries(paths)) {
		if (name !== "services" && !existsSync(path))
			throw new Error(`Bundled ${name} runtime is missing: ${path}`);
	}
	if (!userDataPath) throw new Error("Electron user data path is unavailable.");

	const dataRoot = join(userDataPath, "runtime");
	const logsDir = join(dataRoot, "logs");
	const agentDir = join(userDataPath, "pi-agent");
	mkdirSync(logsDir, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	process.env.TINADEC_PI_AGENT_DIR = agentDir;

	let ownsCore = false;
	try {
		if (!(await reachable(`${CORE_URL}/api/v1/health`))) {
			const core = startProcess(
				"core",
				paths.bun,
				[paths.core],
				paths.services,
				{
					...process.env,
					NODE_ENV: "production",
					TINADEC_CORE_PORT: "48731",
					TINADEC_DATA_DIR: join(dataRoot, "core"),
					TINADEC_PI_AGENT_DIR: agentDir,
				},
				logsDir,
			);
			await waitForService(`${CORE_URL}/api/v1/health`, core, "TinadecPi Core");
			ownsCore = true;
		}

		if (!(await reachable(`${DEFAULT_GATEWAY_URL}/api/v1/health`))) {
			const gateway = startProcess(
				"gateway",
				paths.bun,
				[paths.gateway],
				paths.services,
				{
					...process.env,
					NODE_ENV: "production",
					TINADEC_GATEWAY_PORT: "48730",
					TINADEC_CORE_URL: CORE_URL,
					TINADEC_TOOLS_BIN: paths.tools,
				},
				logsDir,
			);
			await waitForService(
				`${DEFAULT_GATEWAY_URL}/api/v1/health`,
				gateway,
				"TinadecOffice Gateway",
			);
		}

		return { started: children.length > 0, ownsCore };
	} catch (error) {
		stopBundledServices();
		throw error;
	}
}

function stopBundledServices() {
	for (const child of children.splice(0).reverse()) {
		if (!child.pid || child.exitCode !== null) continue;
		if (process.platform === "win32") {
			spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
				stdio: "ignore",
				windowsHide: true,
			});
		} else {
			child.kill("SIGTERM");
		}
	}
	for (const logFd of logFds) closeSync(logFd);
	logFds.clear();
}

module.exports = {
	DEFAULT_GATEWAY_URL,
	bundledRuntimePaths,
	shouldStartBundledServices,
	startBundledServices,
	stopBundledServices,
};
