import test from "node:test";
import assert from "node:assert/strict";
import { containerToReaderDocument, isLyricContainerText, parseLyricContainer, readerDocumentToContainer, serializeLyricContainer } from "../assets/js/lyric-container.js";

function readerDocumentFixture(source = "本文") {
  return {
    version: 3,
    content: {
      format: "narou-text",
      activeVariantId: "original",
      variants: [{ id: "original", label: "原文", role: "source", source: { text: source, url: "fixture:" } }]
    },
    meta: { title: "題" },
    registry: { palettes: { "2": "#b52d2d" } }
  };
}

test("canonical Container preserves the exact active Author Source", () => {
  const source = "題\n[如何《どう》:c=2]\n--- LYRIC-READER/1 ---";
  const document = readerDocumentFixture(source);
  const encoded = serializeLyricContainer(document, "original");
  const parsed = parseLyricContainer(encoded);
  assert.equal(isLyricContainerText(encoded), true);
  assert.equal(parsed.source, source);
  assert.equal(containerToReaderDocument(parsed).content.variants[0].source.text, source);
});

test("Container keeps non-active Variant sources and unknown Header fields", () => {
  const document = readerDocumentFixture("原文");
  document.content.variants.push({ id: "modern", label: "現代", role: "", source: { text: "現代", url: "inline:" } });
  document.extraField = { retained: true };
  const parsed = parseLyricContainer(serializeLyricContainer(document, "original"));
  const restored = containerToReaderDocument(parsed);
  assert.equal(restored.content.variants[1].source.text, "現代");
  assert.deepEqual(restored.extraField, { retained: true });
});

test("unknown Container version warns but best-effort reads a valid Header", () => {
  const parsed = parseLyricContainer("LYRIC-READER/99\n{\"container\":\"lyric-reader\",\"version\":99,\"document\":{\"version\":3,\"content\":{\"activeVariantId\":\"original\",\"variants\":[{\"id\":\"original\",\"source\":{\"kind\":\"body\"}}]}}}\n\n本文");
  assert.equal(parsed.warnings.includes("unknown-version"), true);
  assert.equal(containerToReaderDocument(parsed).content.variants[0].source.text, "本文");
});

test("malformed Container Header fails closed without executing its contents", () => {
  assert.throws(() => parseLyricContainer("LYRIC-READER/1\n{bad}\n\n本文"), /Header|形式|不正/);
});

test("Container parser accepts CRLF framing while preserving the body", () => {
  const parsed = parseLyricContainer("LYRIC-READER/1\r\n{\"container\":\"lyric-reader\",\"version\":1,\"document\":{\"version\":3,\"content\":{\"activeVariantId\":\"original\",\"variants\":[{\"id\":\"original\",\"source\":{\"kind\":\"body\"}}]}}}\r\n\r\n本文\r\n二行目");
  assert.equal(parsed.source, "本文\r\n二行目");
});
