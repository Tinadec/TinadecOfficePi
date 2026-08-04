const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
	CORE_URL,
	DEFAULT_GATEWAY_URL,
	buildServiceEnvironment,
	bundledRuntimePaths,
	createServiceManager,
	matchesServiceIdentity,
	probeService,
	shouldStartBundledServices,
	startBundledServices,
} = require("./serviceManager.cjs");

const coreHealth = {
	name: "Tinadec Pi",
	status: "ok",
	version: "0.1.0",
	runtime: "pi-agent-sdk",
};
const gatewayHealth = {
	...coreHealth,
	gateway: "ok",
	core_url: CORE_URL,
};

test("bundled services start for the exact packaged loopback gateway only", () => {
	assert.equal(shouldStartBundledServices(true, DEFAULT_GATEWAY_URL), true);
	assert.equal(
		shouldStartBundledServices(true, "http://127.0.0.1:48730/"),
		true,
	);
	assert.equal(
		shouldStartBundledServices(true, "http://localhost:48730"),
		false,
	);
	assert.equal(
		shouldStartBundledServices(true, "http://127.0.0.1:48730/?source=x"),
		false,
	);
	assert.equal(shouldStartBundledServices(false, DEFAULT_GATEWAY_URL), false);
	assert.equal(
		shouldStartBundledServices(true, "https://gateway.example.com"),
		false,
	);
});

test("development and custom gateways do not claim the bundled Core", async () => {
	const skipped = { started: false, ownsCore: false };
	assert.deepEqual(
		await startBundledServices({
			isPackaged: false,
			gatewayUrl: DEFAULT_GATEWAY_URL,
		}),
		skipped,
	);
	assert.deepEqual(
		await startBundledServices({
			isPackaged: true,
			gatewayUrl: "https://gateway.example.com",
		}),
		skipped,
	);
});

test("bundled runtime paths use the staged Node and native tool names", () => {
	const windows = bundledRuntimePaths("C:\\resources", "win32");
	const linux = bundledRuntimePaths("/opt/resources", "linux");
	assert.match(windows.node, /runtime[\\/]node[\\/]node\.exe$/);
	assert.match(windows.tools, /TinadecTools\.exe$/);
	assert.match(windows.git, /runtime[\\/]git[\\/]cmd[\\/]git\.exe$/);
	assert.match(windows.bash, /runtime[\\/]git[\\/]bin[\\/]bash\.exe$/);
	assert.match(linux.node, /runtime[\\/]node[\\/]bin[\\/]node$/);
	assert.match(linux.tools, /TinadecTools$/);
	assert.equal(linux.git, undefined);
	assert.equal(linux.bash, undefined);
});

test("service environments prepend bundled Node, tools, Git, and Bash directories", () => {
	const paths = bundledRuntimePaths("C:\\resources", "win32");
	const env = buildServiceEnvironment(paths, { Path: "C:\\Windows" }, "win32");
	assert.equal(
		env.Path,
		`${paths.nodeDir};${paths.toolsDir};${paths.gitCmdDir};${paths.gitBinDir};C:\\Windows`,
	);
	assert.equal(env.PATH, undefined);
});

test("health checks require the Tinadec service identity and version", async () => {
	assert.equal(matchesServiceIdentity("core", coreHealth), true);
	assert.equal(matchesServiceIdentity("gateway", gatewayHealth), true);
	assert.equal(
		matchesServiceIdentity("core", { ...coreHealth, version: "9.9.9" }),
		false,
	);
	assert.equal(
		matchesServiceIdentity("gateway", { ...coreHealth, gateway: "ok" }),
		false,
	);
	assert.deepEqual(
		await probeService("http://127.0.0.1/health", "core", {
			fetchImpl: async () => ({
				ok: true,
				json: async () => ({ ok: true }),
			}),
		}),
		{ status: "mismatch" },
	);
});

test("packaged services launch with Node and clear ownership on repeated stop", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "tinadec-service-manager-"));
	const resourcesPath = path.join(root, "resources");
	const userDataPath = path.join(root, "user-data");
	const paths = bundledRuntimePaths(resourcesPath, "win32");
	for (const file of [
		paths.node,
		paths.core,
		paths.gateway,
		paths.tools,
		paths.git,
		paths.bash,
	]) {
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, "");
	}

	const launches = [];
	const taskKills = [];
	const attempts = new Map();
	let nextPid = 100;
	class FakeChild extends EventEmitter {
		constructor() {
			super();
			this.pid = nextPid++;
			this.exitCode = null;
			this.signalCode = null;
		}

		kill() {}
	}

	const manager = createServiceManager({
		platform: "win32",
		fetchImpl: async (url) => {
			const attempt = (attempts.get(url) ?? 0) + 1;
			attempts.set(url, attempt);
			if (attempt === 1) throw new Error("not listening");
			return {
				ok: true,
				json: async () =>
					url.startsWith(CORE_URL) ? coreHealth : gatewayHealth,
			};
		},
		spawnImpl: (command, args, options) => {
			const child = new FakeChild();
			launches.push({ command, args, options, child });
			return child;
		},
		spawnSyncImpl: (command, args) => {
			taskKills.push({ command, args });
			return { status: 0 };
		},
	});

	try {
		assert.deepEqual(
			await manager.startBundledServices({
				isPackaged: true,
				gatewayUrl: DEFAULT_GATEWAY_URL,
				resourcesPath,
				userDataPath,
			}),
			{ started: true, ownsCore: true },
		);
		assert.deepEqual(manager.ownedServiceLabels(), ["core", "gateway"]);
		assert.equal(launches.length, 2);
		assert.equal(launches[0].command, paths.node);
		assert.deepEqual(launches[0].args, [paths.core]);
		assert.equal(launches[1].command, paths.node);
		assert.deepEqual(launches[1].args, [paths.gateway]);
		const pathEntry = Object.entries(launches[0].options.env).find(
			([key]) => key.toLowerCase() === "path",
		)?.[1];
		assert.ok(
			pathEntry.startsWith(
				`${paths.nodeDir};${paths.toolsDir};${paths.gitCmdDir};${paths.gitBinDir}`,
			),
		);

		await manager.stopBundledServices();
		await manager.stopBundledServices();
		assert.deepEqual(manager.ownedServiceLabels(), []);
		assert.deepEqual(
			taskKills.map((entry) => entry.args[1]),
			["101", "100"],
		);
	} finally {
		await manager.stopBundledServices();
		rmSync(root, { recursive: true, force: true });
	}
});
