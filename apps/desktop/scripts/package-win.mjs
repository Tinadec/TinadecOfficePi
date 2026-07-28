import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep NSIS/portable temp off C: — full system TEMP makes makensis mmap fail.
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = join(desktopDir, ".runtime-cache", "tmp");
mkdirSync(tmp, { recursive: true });

const result = spawnSync(
	process.platform === "win32" ? "npx.cmd" : "npx",
	["electron-builder", "--win", "--x64", ...process.argv.slice(2)],
	{
		cwd: desktopDir,
		env: {
			...process.env,
			TEMP: tmp,
			TMP: tmp,
			TMPDIR: tmp,
		},
		stdio: "inherit",
		windowsHide: true,
		shell: process.platform === "win32",
	},
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
