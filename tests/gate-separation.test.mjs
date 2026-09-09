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

test("Reader, Shared, and Writer unit tests have separate workflow responsibilities", () => {
  const workflow = readRepoFile(".github/workflows/deploy-pages.yml");
  const readerStart = workflow.indexOf("  reader-quality:");
  const writerUnitStart = workflow.indexOf("  writer-unit:");
  const writerBetaStart = workflow.indexOf("  writer-beta:");
  const deployStart = workflow.indexOf("  deploy:");
  assert.ok(readerStart >= 0 && writerUnitStart > readerStart && writerBetaStart > writerUnitStart && deployStart > writerBetaStart, "workflow jobs must keep their declared order");

  const readerJob = workflow.slice(readerStart, writerUnitStart);
  const writerUnitJob = workflow.slice(writerUnitStart, writerBetaStart);
  const writerBetaJob = workflow.slice(writerBetaStart, deployStart);
  assert.match(readerJob, /npm run test:reader/);
  assert.match(readerJob, /npm run test:shared/);
  assert.doesNotMatch(readerJob, /node --test tests\/\*\.test\.mjs|npm run test:writer-unit|tests\/source-editor\.test\.mjs/);
  assert.match(writerUnitJob, /npm run test:writer-unit/);
  assert.match(writerUnitJob, /continue-on-error:\s*true/);
  assert.match(writerBetaJob, /npm run test:writer/);
  assert.match(writerBetaJob, /continue-on-error:\s*true/);
  assert.match(workflow.slice(deployStart), /needs:\s*reader-quality/);
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
