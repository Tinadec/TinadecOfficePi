import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
	accessSync,
	constants,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { extractFile, listPackage } = require("@electron/asar");
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(process.argv[2] ?? join(desktopDir, "release"));
const productName = "TinadecOffice";

function fail(message) {
	throw new Error(message);
}

function requireFile(path, label) {
	if (!existsSync(path) || !statSync(path).isFile()) {
		fail(`${label} is missing: ${path}`);
	}
	if (statSync(path).size === 0) fail(`${label} is empty: ${path}`);
	return path;
}

function requireDirectory(path, label) {
	if (!existsSync(path) || !statSync(path).isDirectory()) {
		fail(`${label} is missing: ${path}`);
	}
	return path;
}

function readJson(path, label) {
	try {
		return JSON.parse(readFileSync(requireFile(path, label), "utf8"));
	} catch (error) {
		fail(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function requireExecutable(path, label) {
	requireFile(path, label);
	if (process.platform !== "win32") {
		try {
			accessSync(path, constants.X_OK);
		} catch (error) {
			if (error?.code === "EACCES") fail(`${label} is not executable: ${path}`);
			throw error;
		}
	}
	return path;
}

function findMacApp() {
	for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith("mac")) continue;
		const app = join(releaseDir, entry.name, `${productName}.app`);
		if (existsSync(app)) return app;
	}
	fail(`Packaged macOS app was not found under ${releaseDir}`);
}

function packagedLayout() {
	if (process.platform === "win32") {
		const root = requireDirectory(
			join(releaseDir, "win-unpacked"),
			"Windows unpacked directory",
		);
		requireFile(join(root, "resources.pak"), "Electron resources.pak");
		requireFile(join(root, "icudtl.dat"), "Electron ICU data");
		requireDirectory(join(root, "locales"), "Electron locales directory");
		return {
			root,
			resources: join(root, "resources"),
			executable: join(root, `${productName}.exe`),
		};
	}

	if (process.platform === "darwin") {
		const root = findMacApp();
		requireDirectory(join(root, "Contents", "Frameworks"), "Electron frameworks");
		return {
			root,
			resources: join(root, "Contents", "Resources"),
			executable: join(root, "Contents", "MacOS", productName),
		};
	}

	if (process.platform === "linux") {
		const root = requireDirectory(
			join(releaseDir, "linux-unpacked"),
			"Linux unpacked directory",
		);
		return {
			root,
			resources: join(root, "resources"),
			executable: join(root, productName),
		};
	}

	fail(`Unsupported package verification platform: ${process.platform}`);
}

function verifyInstallableArtifacts() {
	const files = readdirSync(releaseDir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);
	const expected =
		process.platform === "win32"
			? [
					["Windows NSIS installer", (name) => name.endsWith("-setup.exe")],
					["Windows ZIP package", (name) => name.endsWith(".zip")],
				]
			: process.platform === "darwin"
				? [
						["macOS DMG", (name) => name.endsWith(".dmg")],
						["macOS ZIP", (name) => name.endsWith(".zip")],
					]
				: [
						["Linux AppImage", (name) => name.endsWith(".AppImage")],
						["Linux Debian package", (name) => name.endsWith(".deb")],
					];

	for (const [label, match] of expected) {
		const artifact = files.find(match);
		if (!artifact) fail(`${label} was not produced in ${releaseDir}`);
		requireFile(join(releaseDir, artifact), label);
	}
}

function verifyAsar(resources) {
	const appAsar = requireFile(join(resources, "app.asar"), "app.asar");
	const entries = new Set(
		listPackage(appAsar).map((entry) =>
			entry.replaceAll("\\", "/").replace(/^\/+/, ""),
		),
	);
	for (const entry of [
		"package.json",
		"dist/index.html",
		"electron/main.cjs",
		"electron/preload.cjs",
		"electron/serviceManager.cjs",
	]) {
		if (!entries.has(entry)) fail(`app.asar is missing ${entry}`);
	}
	if ([...entries].some((entry) => entry.endsWith(".test.cjs"))) {
		fail("app.asar contains Electron test files");
	}

	let manifest;
	try {
		manifest = JSON.parse(extractFile(appAsar, "package.json").toString("utf8"));
	} catch (error) {
		fail(
			`Cannot read the app.asar package manifest: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (manifest.name !== "@tinadec/desktop") {
		fail(`Unexpected app.asar package name: ${String(manifest.name)}`);
	}
	if (manifest.main !== "electron/main.cjs") {
		fail(`Unexpected app.asar main entry: ${String(manifest.main)}`);
	}

	const unpackedPty = join(
		resources,
		"app.asar.unpacked",
		"node_modules",
		"node-pty",
	);
	requireDirectory(unpackedPty, "Unpacked node-pty native module");
	requireFile(join(unpackedPty, "package.json"), "Unpacked node-pty manifest");
	const nativeRoot = join(
		unpackedPty,
		"prebuilds",
		`${process.platform}-${process.arch}`,
	);
	for (const file of process.platform === "win32"
		? [
				"pty.node",
				"conpty.node",
				"conpty_console_list.node",
				"winpty-agent.exe",
				"winpty.dll",
				join("conpty", "OpenConsole.exe"),
				join("conpty", "conpty.dll"),
			]
		: ["pty.node", "spawn-helper"]) {
		const path = join(nativeRoot, file);
		if (file === "spawn-helper" || file.endsWith(".exe")) {
			requireExecutable(path, `node-pty native file ${file}`);
		} else {
			requireFile(path, `node-pty native file ${file}`);
		}
	}
	console.log(`Verified app.asar (${entries.size} entries, version ${manifest.version}).`);
}

function findDependencyManifest(services, packageName) {
	const packagePath = packageName.split("/");
	const codingAgent = join(
		services,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const roots = [
		join(services, "node_modules"),
		join(codingAgent, "node_modules"),
		join(
			codingAgent,
			"node_modules",
			"@earendil-works",
			"pi-ai",
			"node_modules",
		),
	];
	const found = roots
		.map((root) => join(root, ...packagePath, "package.json"))
		.find((candidate) => existsSync(candidate));
	if (!found) fail(`Packaged runtime dependency is missing: ${packageName}`);
	const manifest = readJson(found, `${packageName} manifest`);
	if (manifest.name !== packageName) {
		fail(`${packageName} manifest has unexpected name ${String(manifest.name)}`);
	}
	return found;
}

function runVersion(command, args, label) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: 10_000,
		windowsHide: true,
	});
	if (result.error) fail(`${label} could not run: ${result.error.message}`);
	if (result.status !== 0) {
		fail(`${label} exited with code ${result.status}: ${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

function verifyRuntimePackageIntegrity(services) {
	const packagePath = join(services, "package.json");
	const lockPath = join(services, "package-lock.json");
	const manifest = readJson(packagePath, "Runtime services dependency manifest");
	const lock = readJson(lockPath, "Runtime services dependency lock");
	const dependencies = manifest.dependencies ?? {};
	const lockedDependencies = lock.packages?.[""]?.dependencies ?? {};
	const lockedPackages = Object.entries(lock.packages ?? {});

	if (lock.lockfileVersion !== 3) {
		fail(`Runtime services lockfileVersion must be 3; found ${String(lock.lockfileVersion)}`);
	}
	if (
		JSON.stringify(Object.entries(dependencies).sort()) !==
		JSON.stringify(Object.entries(lockedDependencies).sort())
	) {
		fail("Runtime services package.json dependencies do not match package-lock.json");
	}

	for (const dependency of [
		"@earendil-works/pi-coding-agent",
		"@elysiajs/cors",
		"@elysiajs/node",
		"@elysiajs/swagger",
		"elysia",
		"pi-observational-memory",
		"pi-subagents",
	]) {
		if (!dependencies[dependency]) {
			fail(`Runtime services manifest is missing dependency ${dependency}`);
		}
	}

	let verifiedPackages = 0;
	for (const [lockedPath, lockedPackage] of lockedPackages) {
		if (!lockedPath) continue;
		const installedPath = join(services, ...lockedPath.split("/"), "package.json");
		if (!existsSync(installedPath)) continue;
		const installed = readJson(installedPath, `Installed package ${lockedPath}`);
		if (installed.version !== lockedPackage.version) {
			fail(
				`Installed ${installed.name ?? lockedPath} is ${String(installed.version)}; lock requires ${String(lockedPackage.version)}`,
			);
		}
		if (
			lockedPackage.resolved?.startsWith("https:") &&
			!lockedPackage.integrity &&
			!lockedPackages.some(
				([, candidate]) =>
					candidate.resolved === lockedPackage.resolved && candidate.integrity,
			)
		) {
			fail(`Runtime lock entry has no integrity hash: ${lockedPath}`);
		}
		verifiedPackages += 1;
	}

	for (const [name, version] of Object.entries(dependencies)) {
		const installed = readJson(
			join(services, "node_modules", ...name.split("/"), "package.json"),
			`Runtime dependency ${name}`,
		);
		if (installed.version !== version) {
			fail(`Runtime dependency ${name} is ${String(installed.version)}; expected ${version}`);
		}
	}

	console.log(`Verified runtime package lock (${verifiedPackages} installed packages).`);
	return [packagePath, lockPath];
}

function verifyRuntime(resources) {
	const runtime = requireDirectory(join(resources, "runtime"), "Bundled runtime");
	const services = requireDirectory(join(runtime, "services"), "Runtime services");
	if (existsSync(join(runtime, "bun"))) {
		fail(`Obsolete Bun runtime was packaged: ${join(runtime, "bun")}`);
	}

	const executableSuffix = process.platform === "win32" ? ".exe" : "";
	const nodeRoot = requireDirectory(join(runtime, "node"), "Bundled Node distribution");
	const nodeBin = join(
		nodeRoot,
		...(process.platform === "win32" ? [] : ["bin"]),
		`node${executableSuffix}`,
	);
	const npmRoot =
		process.platform === "win32"
			? join(nodeRoot, "node_modules", "npm")
			: join(nodeRoot, "lib", "node_modules", "npm");
	const npmCli = join(npmRoot, "bin", "npm-cli.js");
	const tools = requireDirectory(join(runtime, "tools"), "Bundled runtime tools");
	const requiredPaths = [
		requireExecutable(nodeBin, "Bundled Node executable"),
		requireFile(join(nodeRoot, "LICENSE"), "Bundled Node license"),
		process.platform === "win32"
			? requireFile(join(nodeRoot, "npm.cmd"), "Bundled npm launcher")
			: requireExecutable(join(nodeRoot, "bin", "npm"), "Bundled npm launcher"),
		process.platform === "win32"
			? requireFile(join(nodeRoot, "npx.cmd"), "Bundled npx launcher")
			: requireExecutable(join(nodeRoot, "bin", "npx"), "Bundled npx launcher"),
		requireFile(join(npmRoot, "package.json"), "Bundled npm manifest"),
		requireFile(npmCli, "Bundled npm CLI"),
		requireFile(join(npmRoot, "bin", "npx-cli.js"), "Bundled npx CLI"),
		requireFile(join(npmRoot, "lib", "npm.js"), "Bundled npm implementation"),
		requireFile(
			join(services, "TinadecPi", "index.js"),
			"Bundled TinadecPi Core entry",
		),
		requireFile(
			join(services, "gateway", "index.js"),
			"Bundled Gateway entry",
		),
		requireExecutable(
			join(tools, `TinadecTools${executableSuffix}`),
			"Bundled TinadecTools executable",
		),
		requireExecutable(join(tools, `rg${executableSuffix}`), "Bundled ripgrep executable"),
		requireExecutable(join(tools, `fd${executableSuffix}`), "Bundled fd executable"),
		requireFile(
			join(
				services,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"dist",
				"core",
				"auth-storage.js",
			),
			"Pi SDK auth storage module",
		),
	];

	if (process.platform === "win32") {
		requiredPaths.push(
			requireExecutable(
				join(runtime, "git", "cmd", "git.exe"),
				"PortableGit git executable",
			),
			requireExecutable(
				join(runtime, "git", "bin", "bash.exe"),
				"PortableGit bash executable",
			),
		);
	}

	requiredPaths.push(...verifyRuntimePackageIntegrity(services));

	for (const dependency of [
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-ai",
		"@anthropic-ai/sdk",
		"@google/genai",
		"openai",
	]) {
		requiredPaths.push(findDependencyManifest(services, dependency));
	}

	const nodeVersion = runVersion(nodeBin, ["--version"], "Staged Node --version");
	const nodeMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
	if (
		!nodeMatch ||
		Number(nodeMatch[1]) < 22 ||
		(Number(nodeMatch[1]) === 22 && Number(nodeMatch[2]) < 19)
	) {
		fail(`Staged Node must be >=22.19.0; found ${nodeVersion || "no version"}`);
	}
	const npmVersion = runVersion(nodeBin, [npmCli, "--version"], "Staged npm");
	if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(npmVersion)) {
		fail(`Staged npm returned an invalid version: ${npmVersion || "no version"}`);
	}
	const npmManifest = readJson(join(npmRoot, "package.json"), "Bundled npm manifest");
	if (npmManifest.name !== "npm" || npmManifest.version !== npmVersion) {
		fail(
			`Bundled npm manifest is ${String(npmManifest.name)} ${String(npmManifest.version)}; CLI returned ${npmVersion}`,
		);
	}

	console.log(`Verified staged Node ${nodeVersion} and npm ${npmVersion}.`);
	console.log("Verified packaged runtime paths:");
	for (const path of requiredPaths) {
		console.log(`  ${relative(resources, path)}`);
	}
}

requireDirectory(releaseDir, "Electron Builder release directory");
const layout = packagedLayout();
requireExecutable(layout.executable, "Packaged desktop executable");
requireDirectory(layout.resources, "Packaged resources directory");
verifyInstallableArtifacts();
verifyAsar(layout.resources);
verifyRuntime(layout.resources);
console.log(`Packaged ${process.platform} output passed validation: ${layout.root}`);
