// Preloaded via --require BEFORE the ESM graph links, so every ESM
// `import { spawn } from "node:child_process"` (including the Pi SDK's tool
// runners) snapshots the patched function. Prevents console windows flashing
// on Windows for every child process (rg, git, bash, subagents, ...).
"use strict";
const cp = require("node:child_process");

function withHide(options) {
	return { windowsHide: true, ...(options ?? {}) };
}

const originalSpawn = cp.spawn;
cp.spawn = function spawn(command, args, options) {
	if (Array.isArray(args)) {
		return originalSpawn.call(this, command, args, withHide(options));
	}
	if (args && typeof args === "object") {
		return originalSpawn.call(this, command, withHide(args));
	}
	return originalSpawn.call(this, command, args, withHide(options));
};

const originalExecFile = cp.execFile;
cp.execFile = function execFile(file, args, options, callback) {
	if (Array.isArray(args)) {
		if (typeof options === "function") {
			return originalExecFile.call(this, file, args, withHide(), options);
		}
		return originalExecFile.call(this, file, args, withHide(options), callback);
	}
	if (typeof args === "function") {
		return originalExecFile.call(this, file, withHide(), args);
	}
	return originalExecFile.call(this, file, withHide(args), options);
};
