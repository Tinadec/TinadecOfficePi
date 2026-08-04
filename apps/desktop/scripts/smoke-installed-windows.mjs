import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
	throw new Error("The installed application smoke test is Windows-only.");
}

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(process.argv[2] ?? join(desktopDir, "release"));
const installRoot = join(
	desktopDir,
	".runtime-cache",
	`i ${process.pid}`,
);
const installDir = join(installRoot, "app");
const smokeRoot = join(installRoot, "application smoke");
const executable = join(installDir, "TinadecOffice.exe");
let uninstaller;
let uninstalled = false;

function findSingle(directory, match, label) {
	const matches = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && match(entry.name))
		.map((entry) => join(directory, entry.name));
	if (matches.length !== 1) {
		throw new Error(`Expected one ${label} in ${directory}; found ${matches.length}.`);
	}
	if (statSync(matches[0]).size === 0) {
		throw new Error(`${label} is empty: ${matches[0]}`);
	}
	return matches[0];
}

function run(label, command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		timeout: 120_000,
		windowsHide: true,
		...options,
	});
	if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
	if (result.status !== 0) {
		throw new Error(`${label} exited with code ${result.status}.`);
	}
}

async function waitForRemoval(path, timeoutMs = 300_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!existsSync(path)) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error(`Installed executable remained after uninstall: ${path}`);
}

const installer = findSingle(
	releaseDir,
	(name) => name.endsWith("-setup.exe"),
	"Windows NSIS installer",
);
if (!installDir.includes(" ")) {
	throw new Error(`Install smoke path must contain spaces: ${installDir}`);
}

rmSync(installRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
mkdirSync(installRoot, { recursive: true });

try {
	run("Silent NSIS install", installer, ["/S", `/D=${installDir}`], {
		timeout: 600_000,
		windowsVerbatimArguments: true,
	});
	if (!existsSync(executable) || !statSync(executable).isFile()) {
		throw new Error(`Installed executable is missing: ${executable}`);
	}
	uninstaller = findSingle(
		installDir,
		(name) => /^uninstall.*\.exe$/i.test(name),
		"Windows uninstaller",
	);

	run(
		"Installed application smoke test",
		process.execPath,
		[join(desktopDir, "scripts", "smoke-packaged-windows.mjs")],
		{
			env: {
				...process.env,
				TINADEC_SMOKE_EXECUTABLE: executable,
				TINADEC_SMOKE_LABEL: "Installed Windows",
				TINADEC_SMOKE_ROOT: smokeRoot,
			},
		},
	);

	run("Silent NSIS uninstall", uninstaller, ["/S"], {
		cwd: installDir,
		timeout: 300_000,
	});
	uninstalled = true;
	await waitForRemoval(executable);
	console.log("Installed Windows smoke test passed and uninstalled cleanly.");
} finally {
	if (!uninstalled && uninstaller && existsSync(uninstaller)) {
		spawnSync(uninstaller, ["/S"], {
			cwd: installDir,
			stdio: "ignore",
			timeout: 300_000,
			windowsHide: true,
		});
	}
	try {
		rmSync(installRoot, {
			recursive: true,
			force: true,
			maxRetries: 4,
			retryDelay: 250,
		});
	} catch (error) {
		console.warn(`Could not remove disposable install-smoke data: ${error.message}`);
	}
}
