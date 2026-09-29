import test from "node:test";
import assert from "node:assert/strict";
import { isReaderJsonFile, loadInput, parseJsonText, validateSourceText, fetchText, parseLocalInput } from "../assets/js/data-loader.js";
import { serializeLyricContainer } from "../assets/js/lyric-container.js";

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

test("streaming URL sources stop at the byte limit before calling response.text", async () => {
  const originalFetch = globalThis.fetch;
  const oversized = new TextEncoder().encode("x".repeat(2_000_001));
  let cancelled = false;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader() {
          let delivered = false;
          return {
            async read() {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              return { done: false, value: oversized };
            },
            async cancel() { cancelled = true; },
            releaseLock() {}
          };
        }
      },
      text() { throw new Error("response.text() should not be used"); }
    });
    await assert.rejects(fetchText("https://reader.example.test/source.txt", "https://reader.example.test/"), /本文が大きすぎ/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local input routes lyric containers before JSON or plain TXT", () => {
  const source = "題\n[如何《どう》:c=2]";
  const document = {
    version: 3,
    content: { format: "narou-text", activeVariantId: "original", variants: [{ id: "original", label: "原文", source: { text: source, url: "fixture:" } }] },
    meta: { title: "題" }
  };
  const loaded = parseLocalInput(serializeLyricContainer(document, "original"), "song.lyric.txt", "text/plain");
  assert.equal(loaded.kind, "reader-document");
  assert.equal(loaded.document.content.variants[0].source.text, source);
  assert.equal(parseLocalInput("本文", "song.txt", "text/plain").kind, "source");
  assert.equal(parseLocalInput('{"content":{"variants":[]}}', "song.json", "application/json").kind, "reader-document");
});

test("local plain TXT detects legacy syntax while preserving vNext defaults", () => {
  const legacy = parseLocalInput("題\n[文字]{c=2}", "legacy.txt", "text/plain");
  assert.equal(legacy.kind, "source");
  assert.equal(legacy.format, "narou-legacy");
  const current = parseLocalInput("題\n[文字:c=2]", "current.txt", "text/plain");
  assert.equal(current.format, "narou-text");
});

test("direct remote TXT detects legacy syntax when no manifest format is provided", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  try {
    globalThis.location = { href: "https://reader.example.test/" };
    globalThis.fetch = async () => new Response("題\n[文字]{c=2}", { status: 200, headers: { "content-length": "16" } });
    const loaded = await loadInput("#src=https%3A%2F%2Freader.example.test%2Fold.txt");
    assert.equal(loaded.manifest.content.format, "narou-legacy");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});

test("Reader JSON without an explicit format detects the legacy Adapter from its Source", () => {
  const legacyJson = JSON.stringify({ version: 3, content: { variants: [{ id: "original", source: { text: "題\n[文字]{c=2}" } }] } });
  const loaded = parseLocalInput(legacyJson, "legacy.json", "application/json");
  assert.equal(loaded.document.content.format, "narou-legacy");
});

test("manifest loading keeps generic Variant metadata and rejects duplicate IDs", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const manifestUrl = "https://reader.example.test/manifest.json";
  const manifestBody = JSON.stringify({
    futureManifestField: { mode: "v2" },
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
    assert.deepEqual(loaded.documentExtensions.futureManifestField, { mode: "v2" });
    responses.set(manifestUrl, { body: JSON.stringify({ content: { variants: [{ id: "same", source: { text: "A" } }, { id: "same", source: { text: "B" } }] } }) });
    await assert.rejects(loadInput(`#m=${encodeURIComponent(manifestUrl)}`), /Variant IDが重複/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});


test("manifest Variant without a source fails before self-fetching the manifest as Source", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const manifestUrl = "https://reader.example.test/missing-source.json";
  let manifestFetches = 0;
  try {
    globalThis.location = { href: "https://reader.example.test/" };
    globalThis.fetch = async resource => {
      if (String(resource) !== manifestUrl) return new Response("", { status: 404 });
      manifestFetches += 1;
      const body = JSON.stringify({ content: { variants: [{ id: "missing", label: "Missing" }] } });
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    };
    const currentDocument = { marker: "keep-current" };
    let committedDocument = currentDocument;
    let failure = null;
    try {
      committedDocument = await loadInput(`#m=${encodeURIComponent(manifestUrl)}`);
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message || "", /Variant.*Source|本文Source/);
    assert.equal(committedDocument, currentDocument, "failed manifest load must not replace Current Document");
    assert.equal(manifestFetches, 1, "the manifest must not be fetched again as Variant Source");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});

test("manifest Variant rejects conflicting supported source forms before fetching either source", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const manifestUrl = "https://reader.example.test/conflicting-source.json";
  const fetched = [];
  try {
    globalThis.location = { href: "https://reader.example.test/" };
    globalThis.fetch = async resource => {
      fetched.push(String(resource));
      if (String(resource) !== manifestUrl) return new Response("unexpected", { status: 200 });
      const body = JSON.stringify({ content: { variants: [{ id: "conflict", text: "inline", src: "./remote.txt" }] } });
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    };
    await assert.rejects(loadInput(`#m=${encodeURIComponent(manifestUrl)}`), /Variant.*Source.*競合|Source指定が競合/);
    assert.deepEqual(fetched, [manifestUrl]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});


test("manifest Variant keeps every supported Source alias and rejects empty remote references", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const manifestUrl = "https://reader.example.test/source-aliases.json";
  let variant = null;
  try {
    globalThis.location = { href: "https://reader.example.test/" };
    globalThis.fetch = async resource => {
      const url = String(resource);
      if (url === manifestUrl) {
        const body = JSON.stringify({ content: { variants: [variant] } });
        return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
      }
      const name = new URL(url).pathname.split("/").pop();
      return new Response(`題\n${name}`, { status: 200 });
    };
    const cases = [
      [{ id: "raw-text", text: "題\nraw-text" }, "題\nraw-text"],
      [{ id: "source-text", source: { text: "題\nsource-text" } }, "題\nsource-text"],
      [{ id: "src", src: "./src.txt" }, "題\nsrc.txt"],
      [{ id: "url", url: "./url.txt" }, "題\nurl.txt"],
      [{ id: "source-string", source: "./source.txt" }, "題\nsource.txt"]
    ];
    for (const [definition, expected] of cases) {
      variant = definition;
      const loaded = await loadInput(`#m=${encodeURIComponent(manifestUrl)}`);
      assert.equal(loaded.variants[0].source.text, expected);
    }
    variant = { id: "empty-remote", src: "   " };
    await assert.rejects(loadInput(`#m=${encodeURIComponent(manifestUrl)}`), /本文Sourceがありません/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});
