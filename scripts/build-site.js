// Copies only the files the app serves into site/, the static output that gets deployed.
// Run after `npm run build` (which produces dist/main.js).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "site");

const files = [
  "index.html",
  "main.css",
  "LICENSE",
  "dist/main.js",
  "dist/main.js.map",
  "dist/ticker.js",
  "encoder/encoder.js",
  "encoder/encoder.wasm",
  "encoder/gifencoder.js",
  "encoder/quantizer.js",
  "encoder/writer.js",
  "media",
];

fs.rmSync(out, { recursive: true, force: true });

for (const file of files) {
  const from = path.join(root, file);

  if (!fs.existsSync(from)) {
    throw new Error(`Missing ${file}; run \`npm run build\` first`);
  }

  fs.cpSync(from, path.join(out, file), { recursive: true });
}

console.log(`Wrote ${files.length} entries to site/`);
