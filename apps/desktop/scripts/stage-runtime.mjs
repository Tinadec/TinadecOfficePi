import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(desktopDir, "..", "..");
const runtimeDir = join(desktopDir, "runtime");
const buildCacheDir = join(desktopDir, ".runtime-cache");
const npmCli = process.env.npm_execpath;
const BUN_VERSION = process.env.TINADEC_BUN_VERSION || "1.3.14";

const rid =
	process.argv[2] ??
	{
		win32: `win-${process.arch}`,
		darwin: `osx-${process.arch === "arm64" ? "arm64" : "x64"}`,
		linux: `linux-${process.arch}`,
	}[process.platform];

if (!rid) throw new Error(`Unsupported platform: ${process.platform}`);

const ridMeta = {
	"win-x64": {
		bunAsset: "bun-windows-x64.zip",
		bunBin: "bun.exe",
		toolsBin: "TinadecTools.exe",
		hostMatch: process.platform === "win32" && process.arch === "x64",
	},
	"win-arm64": {
		bunAsset: "bun-windows-x64.zip",
		bunBin: "bun.exe",
		toolsBin: "TinadecTools.exe",
		hostMatch: process.platform === "win32" && process.arch === "arm64",
	},
	"linux-x64": {
		bunAsset: "bun-linux-x64.zip",
		bunBin: "bun",
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "linux" && process.arch === "x64",
	},
	"linux-arm64": {
		bunAsset: "bun-linux-aarch64.zip",
		bunBin: "bun",
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "linux" && process.arch === "arm64",
	},
	"osx-x64": {
		bunAsset: "bun-darwin-x64.zip",
		bunBin: "bun",
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "darwin" && process.arch === "x64",
	},
	"osx-arm64": {
		bunAsset: "bun-darwin-aarch64.zip",
		bunBin: "bun",
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "darwin" && process.arch === "arm64",
	},
}[rid];

if (!ridMeta) throw new Error(`Unsupported runtime RID: ${rid}`);

if (
	process.platform === "win32" &&
	Number(process.versions.node.split(".")[0]) >= 24 &&
	!process.versions.electron
) {
	const electron = join(
		rootDir,
		"node_modules",
		"electron",
		"dist",
		"electron.exe",
	);
	const result = spawnSync(
		electron,
		[fileURLToPath(import.meta.url), ...process.argv.slice(2)],
		{
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: "inherit",
			windowsHide: true,
		},
	);
	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}

function run(command, args, cwd = rootDir, extraEnv = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: { ...process.env, ...extraEnv },
		stdio: "inherit",
		windowsHide: true,
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`${command} exited with code ${result.status}`);
}

function runNpm(args, cwd = rootDir) {
	if (!npmCli) throw new Error("stage:runtime must be launched through npm.");
	run(process.execPath, [npmCli, ...args], cwd);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Cannot read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function findHostBun() {
	const executable = process.platform === "win32" ? "bun.exe" : "bun";
	const pathEntries = String(process.env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean);
	const candidates = [
		process.env.BUN_INSTALL && join(process.env.BUN_INSTALL, "bin", executable),
		...pathEntries.map((entry) => join(entry, executable)),
		...(process.platform === "win32"
			? pathEntries.map((entry) =>
					join(entry, "node_modules", "bun", "bin", "bun.exe"),
				)
			: []),
		join(rootDir, "node_modules", "bun", "bin", executable),
	].filter(Boolean);
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found)
		throw new Error("Bun was not found. Install Bun before packaging.");
	return found;
}

function findFileRecursive(dir, name) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isFile() && entry.name === name) return full;
		if (entry.isDirectory()) {
			const nested = findFileRecursive(full, name);
			if (nested) return nested;
		}
	}
	return null;
}

function stageBun() {
	const stagedBun = join(runtimeDir, "bun", ridMeta.bunBin);
	if (ridMeta.hostMatch) {
		copyFileSync(findHostBun(), stagedBun);
	} else {
		const cacheZip = join(buildCacheDir, "bun", `${BUN_VERSION}-${ridMeta.bunAsset}`);
		mkdirSync(dirname(cacheZip), { recursive: true });
		if (!existsSync(cacheZip)) {
			const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${ridMeta.bunAsset}`;
			console.log(`Downloading Bun ${BUN_VERSION} for ${rid}...`);
			const result = spawnSync(
				"curl",
				["-fsSL", "-o", cacheZip, url],
				{ stdio: "inherit", windowsHide: true },
			);
			if (result.status !== 0) {
				rmSync(cacheZip, { force: true });
				throw new Error(`Failed to download Bun for ${rid} from ${url}`);
			}
		}
		const extractDir = join(buildCacheDir, "bun", `extract-${rid}`);
		rmSync(extractDir, { recursive: true, force: true });
		mkdirSync(extractDir, { recursive: true });
		run("tar", ["-xf", cacheZip, "-C", extractDir]);
		const extracted = findFileRecursive(extractDir, ridMeta.bunBin);
		if (!extracted) throw new Error(`Bun archive for ${rid} did not contain ${ridMeta.bunBin}`);
		copyFileSync(extracted, stagedBun);
	}
	if (!rid.startsWith("win-")) chmodSync(stagedBun, 0o755);
	return stagedBun;
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(join(runtimeDir, "bun"), { recursive: true });
mkdirSync(join(runtimeDir, "services"), { recursive: true });
mkdirSync(join(runtimeDir, "tools"), { recursive: true });
mkdirSync(join(buildCacheDir, "nuget"), { recursive: true });
mkdirSync(join(buildCacheDir, "nuget-http"), { recursive: true });
mkdirSync(join(buildCacheDir, "temp"), { recursive: true });
mkdirSync(join(buildCacheDir, "dotnet"), { recursive: true });

runNpm(["run", "build", "-w", "@tinadec/pi-core"]);
runNpm(["run", "build", "-w", "@tinadec/gateway"]);
stageBun();

const corePackage = readJson(join(rootDir, "TinadecPi", "package.json"));
const gatewayPackage = readJson(join(rootDir, "gateway", "package.json"));
const lock = readJson(join(rootDir, "package-lock.json"));
const dependencyNames = new Set([
	...Object.keys(corePackage.dependencies ?? {}),
	...Object.keys(gatewayPackage.dependencies ?? {}),
]);
const dependencies = Object.fromEntries(
	[...dependencyNames].sort().map((name) => {
		const version = lock.packages?.[`node_modules/${name}`]?.version;
		if (!version)
			throw new Error(`Cannot resolve locked runtime dependency: ${name}`);
		return [name, version];
	}),
);
writeFileSync(
	join(runtimeDir, "services", "package.json"),
	`${JSON.stringify({ private: true, type: "module", dependencies }, null, 2)}\n`,
);
cpSync(
	join(rootDir, "TinadecPi", "dist"),
	join(runtimeDir, "services", "TinadecPi"),
	{ recursive: true },
);
cpSync(
	join(rootDir, "gateway", "dist"),
	join(runtimeDir, "services", "gateway"),
	{ recursive: true },
);
runNpm(
	["install", "--omit=dev", "--no-audit", "--no-fund"],
	join(runtimeDir, "services"),
);

run(
	"dotnet",
	[
		"publish",
		join(rootDir, "TinadecTools", "TinadecTools.csproj"),
		"-c",
		"Release",
		"-r",
		rid,
		"--self-contained",
		"true",
		"-p:PublishAot=false",
		"-o",
		join(runtimeDir, "tools"),
	],
	rootDir,
	{
		DOTNET_CLI_HOME: join(buildCacheDir, "dotnet"),
		NUGET_PACKAGES: join(buildCacheDir, "nuget"),
		NUGET_HTTP_CACHE_PATH: join(buildCacheDir, "nuget-http"),
		NUGET_SCRATCH: join(buildCacheDir, "temp"),
		TEMP: join(buildCacheDir, "temp"),
		TMP: join(buildCacheDir, "temp"),
	},
);

if (!existsSync(join(runtimeDir, "tools", ridMeta.toolsBin))) {
	throw new Error(`TinadecTools publish did not produce ${ridMeta.toolsBin}.`);
}
console.log(
	`Staged Bun, services, and self-contained TinadecTools for ${rid}.`,
);
