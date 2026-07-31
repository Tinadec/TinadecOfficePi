import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(desktopDir, "..", "..");
const runtimeDir = join(desktopDir, "runtime");
const buildCacheDir = join(desktopDir, ".runtime-cache");
const npmCli = process.env.npm_execpath;
const NODE_VERSION = "22.23.2";
const RIPGREP_VERSION = "15.1.0";

const rid =
	process.argv[2] ??
	{
		win32: `win-${process.arch}`,
		darwin: `osx-${process.arch === "arm64" ? "arm64" : "x64"}`,
		linux: `linux-${process.arch}`,
	}[process.platform];

if (!rid) throw new Error(`Unsupported platform: ${process.platform}`);

// Pinned from the official v22.23.2 SHASUMS256.txt release manifest.
const ridMeta = {
	"win-x64": {
		nodeAsset: `node-v${NODE_VERSION}-win-x64.zip`,
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`,
		ripgrepBin: "rg.exe",
		ripgrepSha256:
			"124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a",
		nodeBin: "node.exe",
		nodeSha256:
			"1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97",
		nodeSource: ["node.exe"],
		toolsBin: "TinadecTools.exe",
		hostMatch: process.platform === "win32" && process.arch === "x64",
	},
	"linux-x64": {
		nodeAsset: `node-v${NODE_VERSION}-linux-x64.tar.gz`,
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
		ripgrepBin: "rg",
		ripgrepSha256:
			"1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599",
		nodeBin: "node",
		nodeSha256:
			"b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a",
		nodeSource: ["bin", "node"],
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "linux" && process.arch === "x64",
	},
	"linux-arm64": {
		nodeAsset: `node-v${NODE_VERSION}-linux-arm64.tar.gz`,
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-aarch64-unknown-linux-gnu.tar.gz`,
		ripgrepBin: "rg",
		ripgrepSha256:
			"2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e",
		nodeBin: "node",
		nodeSha256:
			"013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30",
		nodeSource: ["bin", "node"],
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "linux" && process.arch === "arm64",
	},
	"osx-x64": {
		nodeAsset: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin.tar.gz`,
		ripgrepBin: "rg",
		ripgrepSha256:
			"64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882",
		nodeBin: "node",
		nodeSha256:
			"58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026",
		nodeSource: ["bin", "node"],
		toolsBin: "TinadecTools",
		hostMatch: process.platform === "darwin" && process.arch === "x64",
	},
	"osx-arm64": {
		nodeAsset: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
		ripgrepBin: "rg",
		ripgrepSha256:
			"378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
		nodeBin: "node",
		nodeSha256:
			"61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6",
		nodeSource: ["bin", "node"],
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

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function extractArchive(archive, destination) {
	if (process.platform === "win32") {
		const quote = (value) => `'${value.replaceAll("'", "''")}'`;
		run("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(destination)} -Force`,
		]);
		return;
	}
	run("tar", ["-xf", archive, "-C", destination]);
}

function downloadNodeArchive(cacheArchive) {
	const url = `https://nodejs.org/dist/v${NODE_VERSION}/${ridMeta.nodeAsset}`;
	const partial = `${cacheArchive}.${process.pid}.download`;
	rmSync(partial, { force: true });
	console.log(`Downloading Node ${NODE_VERSION} for ${rid}...`);
	const result = spawnSync(
		"curl",
		["-fsSL", "--retry", "3", "-o", partial, url],
		{ stdio: "inherit", windowsHide: true },
	);
	if (result.error) {
		rmSync(partial, { force: true });
		throw new Error(`Cannot download Node for ${rid}: ${result.error.message}`);
	}
	if (result.status !== 0) {
		rmSync(partial, { force: true });
		throw new Error(`Failed to download Node for ${rid} from ${url}`);
	}
	const actual = sha256(partial);
	if (actual !== ridMeta.nodeSha256) {
		rmSync(partial, { force: true });
		throw new Error(
			`Node archive checksum mismatch for ${rid}: expected ${ridMeta.nodeSha256}, got ${actual}`,
		);
	}
	renameSync(partial, cacheArchive);
}

function stageRipgrep() {
	const cacheArchive = join(buildCacheDir, "ripgrep", ridMeta.ripgrepAsset);
	const stagedRipgrep = join(buildCacheDir, "ripgrep", rid, ridMeta.ripgrepBin);
	mkdirSync(dirname(cacheArchive), { recursive: true });
	mkdirSync(dirname(stagedRipgrep), { recursive: true });
	if (existsSync(cacheArchive) && sha256(cacheArchive) !== ridMeta.ripgrepSha256) {
		console.warn(`Discarding invalid cached ripgrep archive for ${rid}.`);
		rmSync(cacheArchive, { force: true });
	}
	if (!existsSync(cacheArchive)) {
		const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${ridMeta.ripgrepAsset}`;
		const partial = `${cacheArchive}.${process.pid}.download`;
		console.log(`Downloading ripgrep ${RIPGREP_VERSION} for ${rid}...`);
		const result = spawnSync("curl", ["-fsSL", "--retry", "3", "-o", partial, url], {
			stdio: "inherit",
			windowsHide: true,
		});
		if (result.error || result.status !== 0) {
			rmSync(partial, { force: true });
			throw new Error(`Failed to download ripgrep for ${rid} from ${url}`);
		}
		if (sha256(partial) !== ridMeta.ripgrepSha256) {
			rmSync(partial, { force: true });
			throw new Error(`Ripgrep archive checksum mismatch for ${rid}.`);
		}
		renameSync(partial, cacheArchive);
	}
	const extractDir = join(buildCacheDir, "ripgrep", `extract-${RIPGREP_VERSION}-${rid}`);
	rmSync(extractDir, { recursive: true, force: true });
	mkdirSync(extractDir, { recursive: true });
	try {
		extractArchive(cacheArchive, extractDir);
		const archiveRoot = ridMeta.ripgrepAsset.replace(/\.(?:zip|tar\.gz)$/, "");
		const extracted = join(extractDir, archiveRoot, ridMeta.ripgrepBin);
		if (!existsSync(extracted)) throw new Error(`Ripgrep archive for ${rid} did not contain ${ridMeta.ripgrepBin}.`);
		copyFileSync(extracted, stagedRipgrep);
	} finally {
		rmSync(extractDir, { recursive: true, force: true });
	}
	if (!rid.startsWith("win-")) chmodSync(stagedRipgrep, 0o755);
	return stagedRipgrep;
}

function stageNode() {
	const stagedNode = join(runtimeDir, "node", ridMeta.nodeBin);
	const canCopyHost =
		ridMeta.hostMatch &&
		process.release.name === "node" &&
		!process.versions.electron &&
		process.versions.node === NODE_VERSION;
	if (canCopyHost) {
		copyFileSync(process.execPath, stagedNode);
	} else {
		const cacheArchive = join(buildCacheDir, "node", ridMeta.nodeAsset);
		mkdirSync(dirname(cacheArchive), { recursive: true });
		if (
			existsSync(cacheArchive) &&
			sha256(cacheArchive) !== ridMeta.nodeSha256
		) {
			console.warn(`Discarding invalid cached Node archive for ${rid}.`);
			rmSync(cacheArchive, { force: true });
		}
		if (!existsSync(cacheArchive)) downloadNodeArchive(cacheArchive);

		const extractDir = join(
			buildCacheDir,
			"node",
			`extract-${NODE_VERSION}-${rid}`,
		);
		rmSync(extractDir, { recursive: true, force: true });
		mkdirSync(extractDir, { recursive: true });
		try {
			extractArchive(cacheArchive, extractDir);
			const archiveRoot = ridMeta.nodeAsset.replace(/\.(?:zip|tar\.gz)$/, "");
			const extracted = join(extractDir, archiveRoot, ...ridMeta.nodeSource);
			if (!existsSync(extracted)) {
				throw new Error(
					`Node archive for ${rid} did not contain ${ridMeta.nodeBin}.`,
				);
			}
			copyFileSync(extracted, stagedNode);
		} finally {
			rmSync(extractDir, { recursive: true, force: true });
		}
	}
	if (!rid.startsWith("win-")) chmodSync(stagedNode, 0o755);
	return stagedNode;
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(join(runtimeDir, "node"), { recursive: true });
mkdirSync(join(runtimeDir, "services"), { recursive: true });
mkdirSync(join(runtimeDir, "tools"), { recursive: true });
mkdirSync(join(buildCacheDir, "nuget"), { recursive: true });
mkdirSync(join(buildCacheDir, "nuget-http"), { recursive: true });
mkdirSync(join(buildCacheDir, "temp"), { recursive: true });
mkdirSync(join(buildCacheDir, "dotnet"), { recursive: true });

runNpm(["run", "build", "-w", "@tinadec/pi-core"]);
runNpm(["run", "build", "-w", "@tinadec/gateway"]);
stageNode();
const ripgrep = stageRipgrep();

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
		`-p:BundledRipgrepPath=${ripgrep}`,
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

for (const file of [ridMeta.toolsBin, ridMeta.ripgrepBin]) {
	if (!existsSync(join(runtimeDir, "tools", file))) {
		throw new Error(`TinadecTools publish did not produce ${file}.`);
	}
}
console.log(
	`Staged Node ${NODE_VERSION}, ripgrep ${RIPGREP_VERSION}, services, and self-contained TinadecTools for ${rid}.`,
);
