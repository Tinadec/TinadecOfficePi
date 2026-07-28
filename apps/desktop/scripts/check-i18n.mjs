// Audit that every i18n key referenced in src/ exists in both locale files.
// Usage: node scripts/check-i18n.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function collectKeys(object, prefix = "") {
	const keys = new Set();
	for (const [key, value] of Object.entries(object)) {
		const full = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object") {
			for (const nested of collectKeys(value, full)) keys.add(nested);
		} else {
			keys.add(full);
		}
	}
	return keys;
}

async function loadLocale(file) {
	const { default: messages } = await import(
		new URL(`file://${join(root, "src", "locales", file)}`).href
	);
	return collectKeys(messages);
}

function walk(dir, files = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!/node_modules|locales/.test(path)) walk(path, files);
			continue;
		}
		if (/\.(vue|ts)$/.test(entry.name)) files.push(path);
	}
	return files;
}

const used = new Map();
for (const file of walk(join(root, "src"))) {
	const text = readFileSync(file, "utf8");
	for (const match of text.matchAll(
		/[^a-zA-Z$]\$?t\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g,
	)) {
		if (!used.has(match[1])) used.set(match[1], []);
		used.get(match[1]).push(file.slice(root.length + 1));
	}
}

const zh = await loadLocale("zh-CN.ts");
const en = await loadLocale("en.ts");

let failures = 0;
for (const [key, files] of [...used.entries()].sort()) {
	const inZh = zh.has(key);
	const inEn = en.has(key);
	if (!inZh || !inEn) {
		failures += 1;
		console.error(
			`MISSING ${!inZh ? "zh" : ""}${!inZh && !inEn ? "+" : ""}${!inEn ? "en" : ""}: ${key}  (${files[0]})`,
		);
	}
}
console.error(
	failures === 0
		? `OK: ${used.size} keys all present in zh-CN and en`
		: `${failures} missing key(s) out of ${used.size}`,
);
process.exit(failures === 0 ? 0 : 1);
