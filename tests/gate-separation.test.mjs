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

test("Tab-local Draft policy does not depend on a cross-tab warning path", () => {
  const app = readRepoFile("assets/js/app.js");
  const requirements = readRepoFile("docs/LYRIC_READER_REQUIREMENTS.md");
  const matrix = readRepoFile("docs/REQUIREMENTS-MATRIX.md");

  assert.doesNotMatch(app, /draftStorageWarning|event\.key\s*===\s*draftKey\(\)/);
  assert.doesNotMatch(requirements, /別Tab更新の警告は補助UXとして残す|別タブ更新の警告は補助UXとして残す/);
  assert.doesNotMatch(matrix, /multi-tab UXは警告のみ/);
  assert.match(requirements, /別Tabで編集してもDraftを共有しない/);
});
