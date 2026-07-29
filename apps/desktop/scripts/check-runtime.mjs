import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(desktopDir, "runtime");
const services = join(runtime, "services");
const testData = join(desktopDir, ".runtime-cache", "health-check");
const isWindows = process.platform === "win32";
const bun = join(runtime, "bun", isWindows ? "bun.exe" : "bun");
const tools = join(
	runtime,
	"tools",
	isWindows ? "TinadecTools.exe" : "TinadecTools",
);
const children = [];

for (const file of [bun, tools]) {
	if (!existsSync(file))
		throw new Error(`Staged runtime file is missing: ${file}`);
}

function start(file, env) {
	const child = spawn(bun, [file], {
		cwd: services,
		env: { ...process.env, ...env },
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	children.push(child);
	return child;
}

async function wait(url, child) {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (child.exitCode !== null)
			throw new Error(`Staged service exited with code ${child.exitCode}`);
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
	const core = start(join(services, "TinadecPi", "index.js"), {
		TINADEC_CORE_PORT: "48831",
		TINADEC_DATA_DIR: join(testData, "core"),
		TINADEC_PI_AGENT_DIR: join(testData, "pi-agent"),
	});
	await wait("http://127.0.0.1:48831/api/v1/health", core);
	const gateway = start(join(services, "gateway", "index.js"), {
		TINADEC_GATEWAY_PORT: "48830",
		TINADEC_CORE_URL: "http://127.0.0.1:48831",
		TINADEC_TOOLS_BIN: tools,
	});
	await wait("http://127.0.0.1:48830/api/v1/health", gateway);
	console.log("Staged Core and Gateway health checks passed.");
} finally {
	for (const child of children.reverse()) stop(child);
}
