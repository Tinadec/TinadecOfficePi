const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
	DEFAULT_GATEWAY_URL,
	bundledRuntimePaths,
	shouldStartBundledServices,
	startBundledServices,
} = require("./serviceManager.cjs");

test("bundled services start for packaged loopback gateways only", () => {
	assert.equal(shouldStartBundledServices(true, DEFAULT_GATEWAY_URL), true);
	assert.equal(
		shouldStartBundledServices(true, "http://localhost:48730"),
		true,
	);
	assert.equal(
		shouldStartBundledServices(true, "http://127.0.0.1:48730/"),
		true,
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

test("bundled runtime paths use platform-native executable names", () => {
	const windows = bundledRuntimePaths("C:\\resources", "win32");
	const linux = bundledRuntimePaths("/opt/resources", "linux");
	assert.match(windows.bun, /bun\.exe$/);
	assert.match(windows.tools, /TinadecTools\.exe$/);
	assert.match(linux.bun, /bun$/);
	assert.match(linux.tools, /TinadecTools$/);
});
