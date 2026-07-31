import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep NSIS/ZIP temp off C: — full system TEMP makes makensis mmap fail.
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(desktopDir, "release");
const builderCli = join(
	desktopDir,
	"..",
	"..",
	"node_modules",
	"electron-builder",
	"cli.js",
);
const tmp = join(desktopDir, ".runtime-cache", "tmp");
mkdirSync(releaseDir, { recursive: true });
mkdirSync(tmp, { recursive: true });

for (const file of readdirSync(releaseDir, { withFileTypes: true })) {
	if (file.isFile() && file.name.endsWith("-portable.exe"))
		rmSync(join(releaseDir, file.name), { force: true });
}

const result = spawnSync(
	process.execPath,
	[
		builderCli,
		"--win",
		"--x64",
		"--publish",
		"never",
		...process.argv.slice(2),
	],
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
	},
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
