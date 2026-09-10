import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getSyntaxAdapter } from "../assets/js/syntax-adapter.js";
import { parseSourceEditorInput, sourceErrorContext, sourceErrorLocation } from "../assets/js/source-editor.js";

const root = process.cwd();

test("Source editor commits the exact Author Source only after a successful parse", () => {
  const adapter = getSyntaxAdapter("narou-text");
  const source = "題名\\n[如何《どう》:c=2]";
  const result = parseSourceEditorInput(source, adapter);

  assert.equal(result.ok, true);
  assert.equal(result.source, source);
  assert.equal(result.document.nodes.length, 2);
});

test("Source editor rejects invalid presentation without producing a commit candidate", () => {
  const adapter = getSyntaxAdapter("narou-text");
  const source = "題名\\n[x:base-range=0-3]";
  const result = parseSourceEditorInput(source, adapter);

  assert.equal(result.ok, false);
  assert.equal(result.source, source);
  assert.equal(result.document, undefined);
  assert.match(result.error.message, /Presentation指定に有効な属性がありません/);
});

test("Source editor reports the source line and column for parse failures", () => {
  const adapter = getSyntaxAdapter("narou-text");
  const source = "題名\n[x:style=bad name]";
  const result = parseSourceEditorInput(source, adapter);

  assert.equal(result.ok, false);
  assert.deepEqual(sourceErrorLocation(source, result.error), result.error.sourceLocation);
  assert.equal(result.error.sourceLocation.line, 2);
  assert.ok(result.error.sourceLocation.column >= 4);
  assert.match(result.error.message, /行2・列\d+/);
});

test("Source editor exposes a compact line-safe context around parse failures", () => {
  const adapter = getSyntaxAdapter("narou-text");
  const source = "題名\n本文\n[x:style=bad name]\n末尾";
  const result = parseSourceEditorInput(source, adapter);

  assert.equal(result.ok, false);
  assert.match(sourceErrorContext(source, result.error), /style=bad name/);
  assert.doesNotMatch(sourceErrorContext(source, result.error), /[\r\n]/);
  assert.ok(sourceErrorContext(source, result.error).length < 64);
  assert.equal(result.error.sourceContext, sourceErrorContext(source, result.error));
});

test("Source mode has an explicit textarea and application route", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");

  assert.match(html, /id="source-mode-switch"/);
  assert.match(html, /id="source-editor"/);
  assert.match(app, /mode === "source"/);
  assert.match(app, /source-editor/);
  assert.match(app, /parseLyricContainer/);
  assert.match(app, /containerToReaderDocument/);
});
