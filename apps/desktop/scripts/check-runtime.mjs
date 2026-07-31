import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "22.23.2";
const PI_SDK = "@earendil-works/pi-coding-agent";
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(desktopDir, "runtime");
const nodeDir = join(runtime, "node");
const services = join(runtime, "services");
const testData = join(desktopDir, ".runtime-cache", "health-check");
const isWindows = process.platform === "win32";
const node = join(nodeDir, isWindows ? "node.exe" : "node");
const tools = join(
	runtime,
	"tools",
	isWindows ? "TinadecTools.exe" : "TinadecTools",
);
const coreEntry = join(services, "TinadecPi", "index.js");
const gatewayEntry = join(services, "gateway", "index.js");
const children = [];
const pathKey =
	Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
	"PATH";
const inheritedPath = process.env[pathKey];
const runtimeEnv = {
	...process.env,
	[pathKey]: inheritedPath
		? `${nodeDir}${delimiter}${inheritedPath}`
		: nodeDir,
};

for (const file of [node, tools, coreEntry, gatewayEntry]) {
	if (!existsSync(file))
		throw new Error(`Staged runtime file is missing: ${file}`);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Cannot read staged JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function checkNodeVersion() {
	const result = spawnSync(node, ["--version"], {
		env: runtimeEnv,
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.error) {
		throw new Error(`Cannot execute staged Node runtime: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`Staged Node version check exited with code ${result.status}: ${result.stderr.trim()}`,
		);
	}
	const actual = result.stdout.trim();
	if (actual !== `v${NODE_VERSION}`) {
		throw new Error(
			`Staged Node version mismatch: expected v${NODE_VERSION}, got ${actual || "no output"}`,
		);
	}
	return actual;
}

function checkPackages() {
	const packagePath = join(services, "package.json");
	if (!existsSync(packagePath)) {
		throw new Error(`Staged service package is missing: ${packagePath}`);
	}
	const stagedPackage = readJson(packagePath);
	const dependencies = stagedPackage.dependencies ?? {};
	if (!Object.hasOwn(dependencies, PI_SDK)) {
		throw new Error(`Staged service package does not declare ${PI_SDK}.`);
	}
	for (const [name, expectedVersion] of Object.entries(dependencies)) {
		const dependencyPath = join(services, "node_modules", name, "package.json");
		if (!existsSync(dependencyPath)) {
			throw new Error(`Staged runtime dependency is missing: ${name}`);
		}
		const dependency = readJson(dependencyPath);
		if (dependency.version !== expectedVersion) {
			throw new Error(
				`Staged runtime dependency ${name} has version ${dependency.version ?? "unknown"}; expected ${expectedVersion}.`,
			);
		}
	}
}

function start(label, file, env) {
	const child = spawn(node, [file], {
		cwd: services,
		env: { ...runtimeEnv, NODE_ENV: "production", ...env },
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.startupError = null;
	child.once("error", (error) => {
		child.startupError = error;
	});
	children.push(child);
	return child;
}

async function wait(label, url, child) {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (child.startupError) {
			throw new Error(`${label} failed to start: ${child.startupError.message}`);
		}
		if (child.signalCode) {
			throw new Error(`${label} exited after signal ${child.signalCode}.`);
		}
		if (child.exitCode !== null)
			throw new Error(`${label} exited with code ${child.exitCode}.`);
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {}
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error(`Timed out waiting for ${url}`);
}

function stop(child) {
	if (!child.pid || child.exitCode !== null) return;
	if (isWindows) child.kill();
	else child.kill("SIGTERM");
}

rmSync(testData, { recursive: true, force: true });
mkdirSync(testData, { recursive: true });
try {
	const nodeVersion = checkNodeVersion();
	checkPackages();
	const core = start("Staged Core", coreEntry, {
		TINADEC_CORE_PORT: "48831",
		TINADEC_DATA_DIR: join(testData, "core"),
		TINADEC_PI_AGENT_DIR: join(testData, "pi-agent"),
	});
	await wait("Staged Core", "http://127.0.0.1:48831/api/v1/health", core);
	const gateway = start("Staged Gateway", gatewayEntry, {
		TINADEC_GATEWAY_PORT: "48830",
		TINADEC_CORE_URL: "http://127.0.0.1:48831",
		TINADEC_TOOLS_BIN: tools,
	});
	await wait(
		"Staged Gateway",
		"http://127.0.0.1:48830/api/v1/health",
		gateway,
	);
	console.log(
		`Staged Node ${nodeVersion}, package, SDK, Core, and Gateway checks passed.`,
	);
} finally {
	for (const child of children.reverse()) stop(child);
}
