import test from "node:test";
import assert from "node:assert/strict";
import { documentIdentity, documentPayload, draftDiffers, draftPayload, migrateReaderDocument, normalizeDraft } from "../assets/js/document-state.js";

const data = {
  manifest: { id: "song-a", registry: { palettes: { "2": "#d02020" } } },
  historical: { text: "古い" }, modern: { text: "現代" }, modernAvailable: true,
  titleSource: "meta", sourceUrl: "reader:", sourceName: "a.reader.json"
};

test("document identity and payload keep variants, registry, and active variant together", () => {
  assert.equal(documentIdentity(data), "song-a|reader:|a.reader.json");
  const payload = documentPayload(data, "題", [{ range: { start: 0, end: 1 } }], "modern");
  assert.equal(payload.activeVariant, "modern");
  assert.equal(payload.historical.text, "古い");
  assert.equal(payload.modern.text, "現代");
  assert.equal(payload.manifest.registry.palettes["2"], "#d02020");
});

test("draft round-trip detects registry-only and variant-only changes", () => {
  const draft = draftPayload(data, "題", [], "modern");
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
  assert.equal(migrated.version, 2);
  assert.equal(migrated.document.historical.text, "[文字]{c=2}");
  assert.equal(migrated.document.manifest.registry.palettes["2"], "#f00");
});

test("Reader Document versions migrate explicitly and future versions fail closed", () => {
  assert.equal(migrateReaderDocument({ content: { text: "本文" } }).version, 2);
  assert.equal(migrateReaderDocument({ version: 1, content: { text: "本文" } }).version, 2);
  assert.throws(() => migrateReaderDocument({ version: 3, content: { text: "本文" } }), /未対応のReader文書version/);
});
