import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Reader mobile gate contains no Writer Source Editor flow", () => {
  const mobileGate = readRepoFile("tests/mobile-viewer-gate.mjs");

  assert.doesNotMatch(mobileGate, /source-mode-switch|source-editor|Source Gate/);
});

test("Pages deploy depends on Reader quality while Writer Beta remains advisory", () => {
  const workflow = readRepoFile(".github/workflows/deploy-pages.yml");

  assert.match(workflow, /reader-quality:/);
  assert.match(workflow, /writer-beta:/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /needs:\s*reader-quality/);
});
