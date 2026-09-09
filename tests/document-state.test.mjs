import test from "node:test";
import assert from "node:assert/strict";
import { documentIdentity, documentPayload, localSourceIdentity, migrateReaderDocument, readerDocumentExtensions } from "../assets/js/document-state.js";

const data = {
  manifest: { id: "song-a", registry: { palettes: { "2": "#d02020" } } },
  historical: { text: "古い" }, modern: { text: "現代" }, modernAvailable: true,
  titleSource: "meta", sourceUrl: "reader:", sourceName: "a.reader.json", sourceIdentity: "source-a"
};

test("document identity and payload keep variants, registry, and active variant together", () => {
  const sourceMetadataData = { ...data, sourceMetadata: { title: "Source title", note: "原注" } };
  assert.equal(documentIdentity(data), "song-a|source-a|reader:|a.reader.json");
  const payload = documentPayload(sourceMetadataData, "題", "modern");
  assert.equal(payload.activeVariantId, "modern");
  assert.equal(payload.variants[0].source.text, "古い");
  assert.equal(payload.variants[1].source.text, "現代");
  assert.equal(payload.manifest.registry.palettes["2"], "#d02020");
  assert.deepEqual(payload.sourceMetadata, { title: "Source title", note: "原注" });
  assert.equal(Object.hasOwn(payload, "annotations"), false);
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
