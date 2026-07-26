// Required first from main.cjs so every child process spawned by the Electron
// main process (node-pty fallback, shell probes, future code) defaults to
// windowsHide and never flashes a console window on Windows.
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
