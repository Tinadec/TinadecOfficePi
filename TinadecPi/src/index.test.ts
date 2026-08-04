import assert from "node:assert/strict";
import test from "node:test";
import {
	readiness,
	runtimeComponents,
	supportsNodeVersion,
} from "./index.js";

const resolvedModules = new Map([
	["pi-subagents", "X:\\modules\\subagents.ts"],
	[
		"pi-observational-memory/src/index.ts",
		"X:\\modules\\observational-memory.ts",
	],
]);

test("supports Node.js 22.19 and newer", () => {
	assert.equal(supportsNodeVersion("22.18.9"), false);
	assert.equal(supportsNodeVersion("22.19.0"), true);
	assert.equal(supportsNodeVersion("23.0.0"), true);
	assert.equal(supportsNodeVersion("invalid"), false);
});

test("runtime checks use injected Windows PATH and resolved extension files", () => {
	const existing = new Set([
		...resolvedModules.values(),
		"X:\\bin\\bash.EXE",
		"X:\\bin\\git.EXE",
	]);
	const components = runtimeComponents([{}], {
		nodeVersion: "22.19.0",
		platform: "win32",
		env: { Path: "X:\\bin", PATHEXT: ".EXE" },
		pathExists: (path) => existing.has(path),
		resolveModule: (specifier) => resolvedModules.get(specifier),
	});

	assert.equal(components.every((component) => component.status === "ready"), true);
	assert.doesNotMatch(JSON.stringify(components), /X:\\\\/);
});

test("readiness derives blocked and warning counts from runtime components", () => {
	const receipt = readiness([], {
		nodeVersion: "22.18.0",
		platform: "linux",
		env: { PATH: "/usr/bin" },
		pathExists: (path) => path === "/usr/bin/bash",
		resolveModule: () => undefined,
	});

	assert.equal(receipt.status, "blocked");
	assert.equal(receipt.warning_count, 1);
	assert.equal(receipt.blocked_count, 4);
	assert.equal(
		receipt.ready_count + receipt.warning_count + receipt.blocked_count,
		receipt.components.length,
	);
	assert.equal(
		receipt.components.find((component) => component.id === "models")?.status,
		"warning",
	);
});
