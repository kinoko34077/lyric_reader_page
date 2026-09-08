import test from "node:test";
import assert from "node:assert/strict";
import { isReaderJsonFile, loadInput, parseJsonText, validateSourceText } from "../assets/js/data-loader.js";

test("JSON parser accepts valid data and rejects malformed input", () => {
  assert.deepEqual(parseJsonText('{"title":"demo"}'), { title: "demo" });
  assert.deepEqual(parseJsonText("\uFEFF{\"title\":\"bom\"}"), { title: "bom" });
  assert.throws(() => parseJsonText("{invalid"), /JSON文書の形式が不正/);
  assert.throws(() => parseJsonText("x".repeat(500_001)), /JSON文書が大きすぎ/);
  assert.deepEqual(parseJsonText(JSON.stringify({ content: { historical: "x".repeat(400_000), modern: "y".repeat(400_000) } }), "reader-document").content.historical.length, 400_000);
  assert.throws(() => parseJsonText("x".repeat(500_001), "manifest"), /JSON文書が大きすぎ/);
  assert.throws(() => validateSourceText("x".repeat(500_001)), /本文が長すぎ/);
});

test("provisional presentation at the start of a TXT is never classified as JSON", () => {
  assert.equal(isReaderJsonFile("song.txt", "text/plain"), false);
  assert.equal(isReaderJsonFile("song.json", "text/plain"), true);
  assert.equal(isReaderJsonFile("song", "application/json"), true);
  assert.equal(isReaderJsonFile("", "", '{"content":"本文"}'), true);
  assert.equal(isReaderJsonFile("", "", "\uFEFF{\"content\":\"本文\"}"), true);
  assert.equal(isReaderJsonFile("", "", "[文字]{c=2}\n本文"), false);
});

test("manifest loading keeps generic Variant metadata and rejects duplicate IDs", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const manifestUrl = "https://reader.example.test/manifest.json";
  const manifestBody = JSON.stringify({
    content: {
      format: "narou-text",
      titleSource: "meta",
      variants: [{ id: "a", label: "原", src: "./a.txt" }, { id: "b", label: "新", source: { text: "題\n新" } }],
      links: [{ id: "link-1", members: [{ variantId: "a", anchor: "a" }, { variantId: "b", anchor: "b" }] }],
      variantOverrides: { b: { "link-1": { color: { type: "palette", index: 2 } } } }
    },
    sourceMetadata: { artist: "Source artist" }
  });
  const responses = new Map([
    [manifestUrl, { body: manifestBody }],
    ["https://reader.example.test/a.txt", { body: "題\n原" }]
  ]);
  try {
    globalThis.location = { href: "https://reader.example.test/" };
    globalThis.fetch = async resource => { const value = responses.get(String(resource)); if (!value) return new Response("", { status: 404 }); return new Response(value.body, { status: 200, headers: { "content-length": String(new TextEncoder().encode(value.body).byteLength) } }); };
    const loaded = await loadInput(`#m=${encodeURIComponent(manifestUrl)}`);
    assert.deepEqual(loaded.variants.map(variant => [variant.id, variant.label]), [["a", "原"], ["b", "新"]]);
    assert.equal(loaded.titleSource, "meta");
    assert.equal(loaded.sourceMetadata.artist, "Source artist");
    assert.equal(loaded.links[0].id, "link-1");
    assert.equal(loaded.variantOverrides.b["link-1"].color.index, 2);
    responses.set(manifestUrl, { body: JSON.stringify({ content: { variants: [{ id: "same", source: { text: "A" } }, { id: "same", source: { text: "B" } }] } }) });
    await assert.rejects(loadInput(`#m=${encodeURIComponent(manifestUrl)}`), /Variant IDが重複/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});
