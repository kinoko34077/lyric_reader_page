import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("HTML module, stylesheet, and config references share one build id", () => {
  const config = fs.readFileSync(path.join(root, "assets/js/config.js"), "utf8");
  const expected = config.match(/BUILD_ID\s*=\s*["']([^"']+)/)?.[1];
  assert.ok(expected, "BUILD_ID must be declared");
  const files = ["index.html", ...fs.readdirSync(path.join(root, "assets/js"), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".js")).map(entry => path.join("assets/js", entry.name))];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const ids = [...source.matchAll(/\?v=([0-9A-Za-z._-]+)/g)].map(match => match[1]);
    if (ids.length) assert.ok(ids.every(id => id === expected), `${file} has a stale build id`);
  }
});

test("canonical Container export stays alongside existing TXT, JSON, and Copy actions", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
  assert.match(html, /id="download-container-button"/);
  assert.match(html, /\.lyric\.txt/);
  assert.match(app, /serializeLyricContainer/);
  assert.match(app, /download-container-button/);
  assert.match(app, /copy-all-button/);
  assert.match(app, /toPortableTextSafe/);
  assert.match(app, /download-reader-button/);
});

test("document-declared Fonts auto-load by default while explicit opt-out remains supported", () => {
  const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
  assert.match(app, /remoteFontsAllowed: true/);
  assert.match(app, /remoteFontsAllowed: saved\.remoteFontsAllowed !== false/);
  assert.match(app, /state\.remoteFontsAllowed = true;/);
  assert.match(app, /if \(!state\.remoteFontsAllowed\) \{ state\.loadedRegistryFonts = loaded; return loaded; \}/);
});
