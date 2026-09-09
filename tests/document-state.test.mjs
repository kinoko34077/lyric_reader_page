import test from "node:test";
import assert from "node:assert/strict";
import { boundedHistory, documentIdentity, documentPayload, draftDiffers, draftPayload, draftStorageKey, localSourceIdentity, migrateReaderDocument, normalizeDraft, readerDocumentExtensions } from "../assets/js/document-state.js";

const data = {
  manifest: { id: "song-a", registry: { palettes: { "2": "#d02020" } } },
  historical: { text: "古い" }, modern: { text: "現代" }, modernAvailable: true,
  titleSource: "meta", sourceUrl: "reader:", sourceName: "a.reader.json"
};

test("document identity and payload keep variants, registry, and active variant together", () => {
  const sourceMetadataData = { ...data, sourceMetadata: { title: "Source title", note: "原注" } };
  assert.equal(documentIdentity(data), "song-a||reader:|a.reader.json");
  const payload = documentPayload(sourceMetadataData, "題", "modern");
  assert.equal(payload.activeVariantId, "modern");
  assert.equal(payload.variants[0].source.text, "古い");
  assert.equal(payload.variants[1].source.text, "現代");
  assert.equal(payload.manifest.registry.palettes["2"], "#d02020");
  assert.deepEqual(payload.sourceMetadata, { title: "Source title", note: "原注" });
  assert.equal(Object.hasOwn(payload, "annotations"), false);
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

test("Reader Document versions migrate explicitly and future versions load best-effort", () => {
  const migrated = migrateReaderDocument({ content: { text: "本文" } });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.content.variants[0].source.text, "本文");
  assert.equal(migrateReaderDocument({ version: 2, content: { historical: "古", modern: "新" } }).content.variants.length, 2);
  const future = migrateReaderDocument({ version: 4, content: { text: "本文", futureField: { keep: true } } });
  assert.equal(future.version, 3);
  assert.equal(future.content.variants[0].source.text, "本文");
  assert.deepEqual(future.content.futureField, { keep: true });
  assert.equal(future.warnings.includes("unknown-version"), true);
});

test("unknown Reader Document fields are retained separately from canonical fields", () => {
  const extensions = readerDocumentExtensions({ version: 4, content: {}, meta: {}, annotations: [{ range: { start: 0, end: 1 } }], futureScalar: "keep", futureObject: { mode: "v2" }, futureArray: ["x"] });
  assert.deepEqual(extensions, { futureScalar: "keep", futureObject: { mode: "v2" }, futureArray: ["x"] });
  assert.equal(Object.hasOwn(extensions, "content"), false);
});

test("legacy Range Annotation data is discarded during Reader migration", () => {
  const migrated = migrateReaderDocument({ version: 4, annotations: [{ range: { start: 0, end: 1 }, style: { color: "red" } }], content: { text: "本文" } });
  assert.equal(Object.hasOwn(migrated, "annotations"), false);
});

test("local identity separates same-name files when metadata or content differs", () => {
  assert.notEqual(localSourceIdentity("lyrics.txt", 10, 1, "aaa"), localSourceIdentity("lyrics.txt", 10, 1, "bbb"));
  assert.notEqual(localSourceIdentity("lyrics.txt", 10, 1, "aaa"), localSourceIdentity("lyrics.txt", 11, 1, "aaa"));
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
