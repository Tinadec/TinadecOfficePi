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
	statSync,
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
const RIPGREP_VERSION = "15.2.0";
const FD_VERSION = "10.3.0";
const PORTABLE_GIT_VERSION = "2.55.0.windows.3";
const PORTABLE_GIT_ASSET = "PortableGit-2.55.0.3-64-bit.7z.exe";
const PORTABLE_GIT_SHA256 =
	"ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d";

const rid =
	process.argv[2] ??
	{
		win32: `win-${process.arch}`,
		darwin: `osx-${process.arch === "arm64" ? "arm64" : "x64"}`,
		linux: `linux-${process.arch}`,
	}[process.platform];

if (!rid) throw new Error(`Unsupported platform: ${process.platform}`);

// Node hashes come from SHASUMS256.txt; native tool hashes come from GitHub release digests.
const ridMeta = {
	"win-x64": {
		nodeAsset: `node-v${NODE_VERSION}-win-x64.zip`,
		nodeSha256:
			"1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97",
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`,
		ripgrepSha256:
			"71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5",
		fdAsset: `fd-v${FD_VERSION}-x86_64-pc-windows-msvc.zip`,
		fdSha256:
			"318aa2a6fa664325933e81fda60d523fff29444129e91ebf0726b5b3bcd8b059",
		nativeSuffix: ".exe",
		toolsBin: "TinadecTools.exe",
	},
	"linux-x64": {
		nodeAsset: `node-v${NODE_VERSION}-linux-x64.tar.gz`,
		nodeSha256:
			"b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a",
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
		ripgrepSha256:
			"33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
		fdAsset: `fd-v${FD_VERSION}-x86_64-unknown-linux-gnu.tar.gz`,
		fdSha256:
			"c3c2bc79f838e780173fc8f18b337ec273e7ba17c7ff8f551be29fc3c19b7916",
		nativeSuffix: "",
		toolsBin: "TinadecTools",
	},
	"linux-arm64": {
		nodeAsset: `node-v${NODE_VERSION}-linux-arm64.tar.gz`,
		nodeSha256:
			"013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30",
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-aarch64-unknown-linux-gnu.tar.gz`,
		ripgrepSha256:
			"a740b91c82eaf9914cfedd353572f2791cbe0162c84101ee0951058f4dcbc90d",
		fdAsset: `fd-v${FD_VERSION}-aarch64-unknown-linux-gnu.tar.gz`,
		fdSha256:
			"66f297e404400a3358e9a0c0b2f3f4725956e7e4435427a9ae56e22adbe73a68",
		nativeSuffix: "",
		toolsBin: "TinadecTools",
	},
	"osx-x64": {
		nodeAsset: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
		nodeSha256:
			"58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026",
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin.tar.gz`,
		ripgrepSha256:
			"af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
		fdAsset: `fd-v${FD_VERSION}-x86_64-apple-darwin.tar.gz`,
		fdSha256:
			"50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3",
		nativeSuffix: "",
		toolsBin: "TinadecTools",
	},
	"osx-arm64": {
		nodeAsset: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
		nodeSha256:
			"61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6",
		ripgrepAsset: `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
		ripgrepSha256:
			"3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
		fdAsset: `fd-v${FD_VERSION}-aarch64-apple-darwin.tar.gz`,
		fdSha256:
			"0570263812089120bc2a5d84f9e65cd0c25e4a4d724c80075c357239c74ae904",
		nativeSuffix: "",
		toolsBin: "TinadecTools",
	},
}[rid];

if (!ridMeta) throw new Error(`Unsupported runtime RID: ${rid}`);

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

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isNonEmptyFile(path) {
	return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}

function requireFile(path, label) {
	if (!isNonEmptyFile(path)) throw new Error(`${label} is missing or empty: ${path}`);
	return path;
}

async function downloadPinned(label, url, asset, expectedSha256) {
	const cacheArchive = join(buildCacheDir, "downloads", asset);
	mkdirSync(dirname(cacheArchive), { recursive: true });
	if (existsSync(cacheArchive) && sha256(cacheArchive) !== expectedSha256) {
		console.warn(`Discarding invalid cached ${label} archive.`);
		rmSync(cacheArchive, { force: true });
	}
	if (existsSync(cacheArchive)) return cacheArchive;

	const partial = `${cacheArchive}.${process.pid}.download`;
	console.log(`Downloading ${label} for ${rid}...`);
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		rmSync(partial, { force: true });
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(
					`Failed to download ${label} from ${url}: HTTP ${response.status}`,
				);
			}
			writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
			const actual = sha256(partial);
			if (actual !== expectedSha256) {
				throw new Error(
					`${label} checksum mismatch: expected ${expectedSha256}, got ${actual}`,
				);
			}
			renameSync(partial, cacheArchive);
			return cacheArchive;
		} catch (error) {
			rmSync(partial, { force: true });
			if (attempt === 3) throw error;
			console.warn(`Retrying ${label} download after attempt ${attempt} failed.`);
			await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 1_000));
		}
	}
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

async function stageNode() {
	const cacheArchive = await downloadPinned(
		`Node ${NODE_VERSION}`,
		`https://nodejs.org/dist/v${NODE_VERSION}/${ridMeta.nodeAsset}`,
		ridMeta.nodeAsset,
		ridMeta.nodeSha256,
	);
	const extractDir = join(buildCacheDir, "extract", `node-${rid}`);
	rmSync(extractDir, { recursive: true, force: true });
	mkdirSync(extractDir, { recursive: true });
	try {
		extractArchive(cacheArchive, extractDir);
		const extracted = join(
			extractDir,
			ridMeta.nodeAsset.replace(/\.(?:zip|tar\.gz)$/, ""),
		);
		requireFile(
			join(extracted, ...(rid.startsWith("win-") ? ["node.exe"] : ["bin", "node"])),
			"Extracted Node executable",
		);
		cpSync(extracted, join(runtimeDir, "node"), { recursive: true });
	} finally {
		rmSync(extractDir, { recursive: true, force: true });
	}
	if (!rid.startsWith("win-")) {
		chmodSync(join(runtimeDir, "node", "bin", "node"), 0o755);
	}
}

async function stageNativeTool(name, version, repository, asset, expectedSha256) {
	const tag = name === "fd" ? `v${version}` : version;
	const cacheArchive = await downloadPinned(
		`${name} ${version}`,
		`https://github.com/${repository}/releases/download/${tag}/${asset}`,
		asset,
		expectedSha256,
	);
	const extractDir = join(buildCacheDir, "extract", `${name}-${rid}`);
	const binary = `${name}${ridMeta.nativeSuffix}`;
	const cacheBinary = join(buildCacheDir, "native", rid, binary);
	rmSync(extractDir, { recursive: true, force: true });
	mkdirSync(extractDir, { recursive: true });
	mkdirSync(dirname(cacheBinary), { recursive: true });
	try {
		extractArchive(cacheArchive, extractDir);
		const extracted = requireFile(
			join(extractDir, asset.replace(/\.(?:zip|tar\.gz)$/, ""), binary),
			`Extracted ${name} executable`,
		);
		copyFileSync(extracted, cacheBinary);
		copyFileSync(extracted, join(runtimeDir, "tools", binary));
	} finally {
		rmSync(extractDir, { recursive: true, force: true });
	}
	if (!rid.startsWith("win-")) {
		chmodSync(cacheBinary, 0o755);
		chmodSync(join(runtimeDir, "tools", binary), 0o755);
	}
	return cacheBinary;
}

async function stagePortableGit() {
	if (rid !== "win-x64") return;
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("PortableGit for win-x64 must be staged on native Windows x64.");
	}
	const cacheArchive = await downloadPinned(
		`PortableGit ${PORTABLE_GIT_VERSION}`,
		`https://github.com/git-for-windows/git/releases/download/v${PORTABLE_GIT_VERSION}/${PORTABLE_GIT_ASSET}`,
		PORTABLE_GIT_ASSET,
		PORTABLE_GIT_SHA256,
	);
	const gitDir = join(runtimeDir, "git");
	rmSync(gitDir, { recursive: true, force: true });
	run(cacheArchive, ["-y", `-o${gitDir}`]);
	const git = join(gitDir, "cmd", "git.exe");
	const bash = join(gitDir, "bin", "bash.exe");
	for (let attempt = 0; attempt < 240; attempt += 1) {
		if (isNonEmptyFile(git) && isNonEmptyFile(bash)) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 500));
	}
	requireFile(git, "PortableGit git executable");
	requireFile(bash, "PortableGit Bash executable");
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(join(runtimeDir, "services"), { recursive: true });
mkdirSync(join(runtimeDir, "tools"), { recursive: true });
mkdirSync(join(buildCacheDir, "nuget"), { recursive: true });
mkdirSync(join(buildCacheDir, "nuget-http"), { recursive: true });
mkdirSync(join(buildCacheDir, "temp"), { recursive: true });
mkdirSync(join(buildCacheDir, "dotnet"), { recursive: true });

runNpm(["run", "build", "-w", "@tinadec/pi-core"]);
runNpm(["run", "build", "-w", "@tinadec/gateway"]);
await stageNode();
const ripgrepSource = await stageNativeTool(
	"rg",
	RIPGREP_VERSION,
	"BurntSushi/ripgrep",
	ridMeta.ripgrepAsset,
	ridMeta.ripgrepSha256,
);
await stageNativeTool(
	"fd",
	FD_VERSION,
	"sharkdp/fd",
	ridMeta.fdAsset,
	ridMeta.fdSha256,
);
await stagePortableGit();

const runtimeManifestDir = join(desktopDir, "runtime-manifest");
for (const file of ["package.json", "package-lock.json"]) {
	copyFileSync(join(runtimeManifestDir, file), join(runtimeDir, "services", file));
}
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
	["ci", "--omit=dev", "--no-audit", "--no-fund"],
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
		`-p:BundledRipgrepPath=${ripgrepSource}`,
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
	`Staged Node ${NODE_VERSION}, ripgrep ${RIPGREP_VERSION}, fd ${FD_VERSION}, services, and self-contained TinadecTools for ${rid}.`,
);
