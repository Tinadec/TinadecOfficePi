import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
	throw new Error("The packaged application smoke test is Windows-only.");
}

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(process.argv[2] ?? join(desktopDir, "release"));
const executable = join(releaseDir, "win-unpacked", "TinadecOffice.exe");
const smokeRoot = join(desktopDir, ".runtime-cache", "packaged-smoke");
const userData = join(smokeRoot, "user-data");
const profile = join(smokeRoot, "profile");
const temporary = join(smokeRoot, "temp");
const coreHealthUrl = "http://127.0.0.1:48731/api/v1/health";
const gatewayHealthUrl = "http://127.0.0.1:48730/api/v1/health";
const readinessUrl = "http://127.0.0.1:48730/api/v1/readiness";
let child;
let smokeError;
let stdout = "";
let stderr = "";

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function fetchJson(url, timeoutMs = 1_000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: { "cache-control": "no-store" },
			signal: controller.signal,
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

async function waitForJson(url, validate, label, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child?.exitCode !== null) {
			throw new Error(
				`Packaged application exited with code ${child.exitCode} before ${label} was ready.`,
			);
		}
		const value = await fetchJson(url);
		if (value && validate(value)) return value;
		await delay(250);
	}
	throw new Error(`Timed out waiting for packaged ${label} at ${url}`);
}

function sanitizedEnvironment() {
	const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
	const env = {
		APPDATA: join(profile, "AppData", "Roaming"),
		COMSPEC: process.env.COMSPEC ?? join(systemRoot, "System32", "cmd.exe"),
		HOME: profile,
		HOMEDRIVE: "C:",
		HOMEPATH: "\\smoke",
		LOCALAPPDATA: join(profile, "AppData", "Local"),
		NO_PROXY: "127.0.0.1,localhost",
		PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD",
		PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE ?? "AMD64",
		SystemRoot: systemRoot,
		TEMP: temporary,
		TINADEC_DISABLE_TRANSPARENCY: "1",
		TMP: temporary,
		USERPROFILE: profile,
		WINDIR: systemRoot,
	};
	env.PATH = [
		join(systemRoot, "System32"),
		systemRoot,
		join(systemRoot, "System32", "Wbem"),
	].join(";");
	return env;
}

function appendOutput(current, chunk) {
	const next = current + chunk.toString();
	return next.length > 32_000 ? next.slice(-32_000) : next;
}

function printDiagnostics() {
	for (const [label, path] of [
		["Core service", join(userData, "runtime", "logs", "core.log")],
		["Gateway service", join(userData, "runtime", "logs", "gateway.log")],
	]) {
		if (!existsSync(path)) continue;
		const log = readFileSync(path, "utf8");
		console.error(`\n--- ${label} log ---\n${log.slice(-32_000)}`);
	}
	if (stdout.trim()) console.error(`\n--- Desktop stdout ---\n${stdout.trim()}`);
	if (stderr.trim()) console.error(`\n--- Desktop stderr ---\n${stderr.trim()}`);
}

async function stopProcessTree() {
	if (child?.pid && child.exitCode === null) {
		spawnSync(
			"taskkill.exe",
			["/pid", String(child.pid), "/t", "/f"],
			{ stdio: "ignore", windowsHide: true },
		);
	}
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const [core, gateway] = await Promise.all([
			fetchJson(coreHealthUrl, 300),
			fetchJson(gatewayHealthUrl, 300),
		]);
		if (!core && !gateway) return;
		await delay(250);
	}
	throw new Error("Packaged service processes remained reachable after termination.");
}

if (!existsSync(executable)) {
	throw new Error(`Packaged Windows executable is missing: ${executable}`);
}
if (
	(await fetchJson(coreHealthUrl, 500)) ||
	(await fetchJson(gatewayHealthUrl, 500))
) {
	throw new Error("Smoke-test ports 48730/48731 are already in use.");
}

rmSync(smokeRoot, { recursive: true, force: true });
for (const directory of [userData, profile, temporary]) {
	mkdirSync(directory, { recursive: true });
}
writeFileSync(
	join(userData, "settings.json"),
	`${JSON.stringify({ gateway_url: "http://127.0.0.1:48730" }, null, 2)}\n`,
);

try {
	child = spawn(
		executable,
		[`--user-data-dir=${userData}`, "--disable-gpu"],
		{
			cwd: dirname(executable),
			env: sanitizedEnvironment(),
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	child.stdout.on("data", (chunk) => {
		stdout = appendOutput(stdout, chunk);
	});
	child.stderr.on("data", (chunk) => {
		stderr = appendOutput(stderr, chunk);
	});
	await new Promise((resolveSpawn, rejectSpawn) => {
		child.once("spawn", resolveSpawn);
		child.once("error", rejectSpawn);
	});

	await waitForJson(
		coreHealthUrl,
		(value) => value.status === "ok" && value.runtime === "pi-agent-sdk",
		"Core health",
	);
	await waitForJson(
		gatewayHealthUrl,
		(value) => value.status === "ok" && value.gateway === "ok",
		"Gateway health",
	);
	const readiness = await waitForJson(
		readinessUrl,
		(value) =>
			["ready", "warning"].includes(value.status) &&
			value.runtime === "pi-agent-sdk" &&
			value.components?.some(
				(component) => component.id === "pi-sdk" && component.status === "ready",
			),
		"runtime readiness",
	);
	console.log(
		`Packaged Windows smoke test passed (readiness: ${readiness.status}).`,
	);
} catch (error) {
	smokeError = error;
	printDiagnostics();
} finally {
	try {
		await stopProcessTree();
	} catch (error) {
		smokeError ??= error;
	}
}

if (smokeError) throw smokeError;
rmSync(smokeRoot, { recursive: true, force: true });
