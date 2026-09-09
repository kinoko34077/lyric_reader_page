import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { boundedHistory, documentPayload, draftDiffers, draftPayload, draftStorageKey, normalizeDraft } from "../assets/js/document-state.js";

const root = process.cwd();
const data = {
  manifest: { id: "song-a", registry: { palettes: { "2": "#d02020" } } },
  historical: { text: "古い" }, modern: { text: "現代" }, modernAvailable: true,
  titleSource: "meta", sourceUrl: "reader:", sourceName: "a.reader.json", sourceIdentity: "source-a"
};

test("history payload retains source routing fields for document-open Undo", () => {
  const payload = documentPayload(data, "題", "modern");
  assert.equal(payload.sourceUrl, "reader:");
  assert.equal(payload.sourceName, "a.reader.json");
  assert.equal(payload.sourceIdentity, "source-a");
});

test("Draft payload keeps the document-level presentation and metadata boundary", () => {
  const draft = draftPayload({
    ...data,
    metadata: { artist: "Artist", note: "Note" },
    manifest: { ...data.manifest, theme: { background: "#101010", color: "#eeeeee" } }
  }, "題", "modern");

  assert.deepEqual(draft.document.metadata, { artist: "Artist", note: "Note" });
  assert.deepEqual(draft.document.manifest.theme, { background: "#101010", color: "#eeeeee" });
  assert.equal(draft.document.variants.length, 2);
  assert.deepEqual(draft.document.manifest.registry.palettes["2"], "#d02020");
});

test("draft round-trip detects registry-only and variant-only changes", () => {
  const draft = draftPayload(data, "題", "modern");
  assert.equal(draftDiffers(draft, draft.document), false);
  const changedRegistry = structuredClone(draft.document);
  changedRegistry.manifest.registry.palettes["2"] = "#000000";
  assert.equal(draftDiffers(draft, changedRegistry), true);
  const changedVariant = structuredClone(draft.document);
  changedVariant.activeVariant = "historical";
  assert.equal(draftDiffers(draft, changedVariant), true);
});

test("legacy draft shape is migrated without losing its source", () => {
  const migrated = normalizeDraft({ raw: "[文字]{c=2}", title: "題", registry: { palettes: { "2": "#f00" } } });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.document.variants[0].source.text, "[文字]{c=2}");
  assert.equal(migrated.document.manifest.registry.palettes["2"], "#f00");
});

test("Draft storage keys isolate browser Tabs while remaining stable within one Tab", () => {
  const documentKey = "song-a||reader:|a.reader.json";
  assert.equal(draftStorageKey(documentKey, "tab-a"), draftStorageKey(documentKey, "tab-a"));
  assert.notEqual(draftStorageKey(documentKey, "tab-a"), draftStorageKey(documentKey, "tab-b"));
  assert.match(draftStorageKey(documentKey, "tab-a"), /^lyric-reader:draft:/);
});

test("history is bounded by count and serialized memory size", () => {
  let history = []; let index = -1;
  for (let i = 0; i < 60; i++) { const result = boundedHistory(history, index, { value: i }); history = result.history; index = result.index; }
  assert.equal(history.length, 40);
  assert.equal(history.at(-1).value, 59);
  const huge = boundedHistory([], -1, { value: "x".repeat(100) }, { maxBytes: 32 });
  assert.equal(huge.history.length, 1);
  assert.equal(huge.history[0].value.length, 100);
});

test("download initiation preserves dirty and Draft recovery state", () => {
  const app = fs.readFileSync(path.join(root, "assets/js/app.js"), "utf8");
  const start = app.indexOf('$("copy-all-button")');
  const end = app.indexOf('$("share-button")', start);
  assert.ok(start >= 0 && end > start, "document export handlers must remain wired together");
  const exports = app.slice(start, end);
  assert.doesNotMatch(exports, /clearDirty\(/);
  assert.doesNotMatch(exports, /clearDraft\(/);
  assert.match(exports, /TXTダウンロードを開始しました/);
  assert.match(exports, /Reader文書ダウンロードを開始しました/);
  assert.match(exports, /\.lyric\.txtダウンロードを開始しました/);
});
