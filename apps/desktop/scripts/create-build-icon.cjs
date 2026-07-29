const { app, nativeImage } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

app.whenReady().then(() => {
	const root = join(__dirname, "..");
	const pngPath = join(root, "public", "tinadec-build.png");
	const macPngPath = join(root, "public", "tinadec-build-mac.png");
	const icoPath = join(root, "public", "tinadec-build.ico");
	const source = nativeImage.createFromPath(
		join(root, "public", "Logo - 白.png"),
	);
	const png = source
		.resize({ width: 256, height: 256, quality: "best" })
		.toPNG();

	writeFileSync(pngPath, png);
	writeFileSync(
		macPngPath,
		source.resize({ width: 512, height: 512, quality: "best" }).toPNG(),
	);

	// ICO supports PNG-compressed frames. A zero width/height byte denotes 256px.
	const header = Buffer.alloc(22);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(1, 4);
	header.writeUInt16LE(1, 10);
	header.writeUInt16LE(32, 12);
	header.writeUInt32LE(png.length, 14);
	header.writeUInt32LE(header.length, 18);
	writeFileSync(icoPath, Buffer.concat([header, png]));
	app.quit();
});
