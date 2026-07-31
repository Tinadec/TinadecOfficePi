import { createRequire } from "node:module";
import {
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
			statSync(path);
			const mode = statSync(path).mode & 0o111;
			if (mode === 0) fail(`${label} is not executable: ${path}`);
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
					["Windows ZIP package", (name) => name.endsWith("-win-x64.zip")],
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

function verifyRuntime(resources) {
	const runtime = requireDirectory(join(resources, "runtime"), "Bundled runtime");
	const services = requireDirectory(join(runtime, "services"), "Runtime services");
	const executableSuffix = process.platform === "win32" ? ".exe" : "";
	const requiredPaths = [
			requireExecutable(
			join(runtime, "node", `node${executableSuffix}`),
			"Bundled JavaScript runtime",
		),
		requireFile(
			join(services, "TinadecPi", "index.js"),
			"Bundled TinadecPi Core entry",
		),
		requireFile(
			join(services, "gateway", "index.js"),
			"Bundled Gateway entry",
		),
		requireExecutable(
			join(runtime, "tools", `TinadecTools${executableSuffix}`),
			"Bundled TinadecTools executable",
		),
		requireExecutable(
			join(runtime, "tools", `rg${executableSuffix}`),
			"Bundled ripgrep executable",
		),
	];

	const serviceManifestPath = join(services, "package.json");
	const serviceManifest = readJson(
		serviceManifestPath,
		"Runtime services dependency manifest",
	);
	for (const dependency of [
		"@earendil-works/pi-coding-agent",
		"@elysiajs/cors",
		"@elysiajs/node",
		"@elysiajs/swagger",
		"elysia",
		"pi-observational-memory",
		"pi-subagents",
	]) {
		if (!serviceManifest.dependencies?.[dependency]) {
			fail(`Runtime services manifest is missing dependency ${dependency}`);
		}
	}
	requiredPaths.push(serviceManifestPath);

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
