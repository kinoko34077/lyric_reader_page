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
