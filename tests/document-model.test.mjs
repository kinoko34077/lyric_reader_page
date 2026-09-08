import test from "node:test";
import assert from "node:assert/strict";
import { activeVariant, linkedPresentation, normalizeActiveVariantId, normalizeDocumentData, normalizeVariants, replaceVariantSource, resolveMetadata, resolveTitle, setVariantOverride } from "../assets/js/document-model.js";

test("generic Variant Set preserves document-defined labels and selects by id", () => {
  const data = normalizeDocumentData({
    variants: [
      { id: "original", label: "原文", role: "source", source: { text: "題\n古い本文" } },
      { id: "modernized", label: "現代表記", role: "reading", source: { text: "題\n新しい本文" } }
    ],
    activeVariantId: "modernized"
  });
  assert.deepEqual(data.variants.map(variant => variant.label), ["原文", "現代表記"]);
  assert.equal(activeVariant(data).source.text, "題\n新しい本文");
  assert.equal(normalizeActiveVariantId(data.variants, "missing"), "original");
});

test("legacy historical/modern data is only an input migration to generic variants", () => {
  const variants = normalizeVariants({ historical: { text: "古" }, modern: { text: "新" }, modernAvailable: true });
  assert.deepEqual(variants.map(variant => variant.id), ["historical", "modern"]);
  assert.deepEqual(variants.map(variant => variant.source.text), ["古", "新"]);
});

test("Source title and metadata take precedence over derived JSON metadata", () => {
  assert.equal(resolveTitle({ source: "題名\n本文" }), "題名");
  assert.equal(resolveTitle({ source: "\n本文", fallback: "無題" }), "無題");
  assert.equal(resolveTitle({ source: "一行目\n本文", explicitTitle: { text: "複数\n行タイトル" } }), "複数\n行タイトル");
  assert.deepEqual(resolveMetadata({ title: "Source title", artist: "Source artist" }, { title: "JSON title", artist: "JSON artist", note: "JSON note" }), { title: "Source title", artist: "Source artist", note: "JSON note" });
});

test("linked presentation sync is offset-independent and supports a per-Variant override", () => {
  const document = {
    variants: [
      { id: "a", label: "A", source: { text: "長い原文" } },
      { id: "b", label: "B", source: { text: "短文" } }
    ],
    links: [{ id: "chorus-1", members: [{ variantId: "a", anchor: "x" }, { variantId: "b", anchor: "x" }], presentation: { style: { type: "style", name: "chorus" }, color: { type: "palette", index: 2 } } }]
  };
  assert.deepEqual(linkedPresentation(document, "b", "chorus-1"), { presentation: { style: { type: "style", name: "chorus" }, color: { type: "palette", index: 2 } }, linked: true, override: false });
  const changed = setVariantOverride(document, "b", "chorus-1", { color: { type: "palette", index: 3 } });
  assert.deepEqual(linkedPresentation(changed, "b", "chorus-1").presentation, { style: { type: "style", name: "chorus" }, color: { type: "palette", index: 3 } });
  assert.deepEqual(linkedPresentation(changed, "a", "chorus-1").presentation, { style: { type: "style", name: "chorus" }, color: { type: "palette", index: 2 } });
});

test("source replacement updates only the selected generic Variant", () => {
  const data = { variants: [{ id: "a", source: { text: "A" } }, { id: "b", source: { text: "B" } }] };
  const changed = replaceVariantSource(data, "b", "B2");
  assert.deepEqual(changed.variants.map(variant => variant.source.text), ["A", "B2"]);
});
