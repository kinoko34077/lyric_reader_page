import test from "node:test";
import assert from "node:assert/strict";
import { applyPresentation, assertCapabilities, clearPresentation, graphemes, narouTextAdapter, nodeLength, parseSource, serializeSource, toPlainText, toPortableText, validateSource } from "../assets/js/syntax-adapter.js";

test("provisional markup becomes typed presentation IR", () => {
  const document = parseSource("[如何《どう》]{c=2,style=title}\n[12]{combine}\n[晴]{glyph=hare-special}");
  assert.equal(document.type, "document");
  assert.deepEqual(document.nodes[0].presentation, {
    color: { type: "palette", index: 2 }, style: { type: "style", name: "title" }
  });
  assert.equal(document.nodes[0].children[0].type, "ruby");
  assert.equal(document.nodes[2].presentation.combine, true);
});

test("author serialization round-trips while portable projections remove presentation", () => {
  const source = "[如何《どう》]{c=2}\n[12]{combine}\n[晴]{glyph=hare-special}";
  const document = parseSource(source);
  assert.equal(serializeSource(document), source);
  assert.equal(toPortableText(document), "如何《どう》\n12\n晴");
  assert.equal(toPlainText(document), "如何\n12\n晴");
});

test("invalid presentation attributes are rejected instead of silently lost", () => {
  assert.equal(validateSource("[文字]{color=#fff}").valid, false);
  assert.equal(validateSource("[文字]{style=bad name}").valid, false);
  assert.equal(validateSource("[文字]{c=2,combine}").valid, true);
});

test("plain ruby and text remain compatible", () => {
  const document = parseSource("如何《どう》\n通常文");
  assert.equal(serializeSource(document), "如何《どう》\n通常文");
  assert.equal(toPortableText(document), "如何《どう》\n通常文");
});

test("presentation editing changes Author Source while Portable Text stays semantic", () => {
  const document = parseSource("如何《どう》\n本文");
  const edited = applyPresentation(document, { start: 0, end: 2 }, { color: { type: "palette", index: 2 } });
  assert.equal(serializeSource(edited), "[如何《どう》]{c=2}\n本文");
  assert.equal(toPortableText(edited), "如何《どう》\n本文");
});

test("clearing a range unwraps presentation without changing source text", () => {
  const document = parseSource("A[如何《どう》]{c=2}B");
  const cleared = clearPresentation(document, { start: 1, end: 3 });
  assert.equal(serializeSource(cleared), "A如何《どう》B");
  assert.equal(toPortableText(cleared), "A如何《どう》B");
});

test("partial Ruby selection keeps the Ruby node intact", () => {
  const document = parseSource("如何《どう》");
  const edited = applyPresentation(document, { start: 0, end: 1 }, { combine: true });
  assert.equal(serializeSource(edited), "[如何《どう》]{combine}");
  assert.equal(toPortableText(edited), "如何《どう》");
});

test("partial presentation application splits a span without duplicating source", () => {
  const edited = applyPresentation(parseSource("[ABCDE]{c=2}"), { start: 1, end: 3 }, { style: { type: "style", name: "x" } });
  assert.equal(serializeSource(edited), "[A]{c=2}[BC]{c=2,style=x}[DE]{c=2}");
  assert.equal(toPlainText(edited), "ABCDE");
  assert.equal((toPlainText(edited).match(/A|B|C|D|E/g) || []).length, 5);
});

test("partial presentation clearing preserves the untouched presentation sides", () => {
  const cleared = clearPresentation(parseSource("[ABCDE]{c=2}"), { start: 1, end: 3 });
  assert.equal(serializeSource(cleared), "[A]{c=2}BC[DE]{c=2}");
  assert.equal(toPortableText(cleared), "ABCDE");
});

test("adapter router rejects unknown formats explicitly", async () => {
  const { getSyntaxAdapter } = await import("../assets/js/syntax-adapter.js");
  assert.equal(getSyntaxAdapter("narou-text").id, "narou-text");
  assert.throws(() => getSyntaxAdapter("unknown-format"), /未対応の本文format/);
});

test("adapter capabilities are negotiated explicitly", () => {
  assert.equal(assertCapabilities(narouTextAdapter, { ruby: true, escapedLiterals: true }), narouTextAdapter);
  assert.throws(() => assertCapabilities({ capabilities: { ruby: true } }, { gradient: true }), /gradientに対応/);
});

test("parser accepts newlines, escaped literals, and nested input without stack overflow", () => {
  const source = "[[A\\[B\\]]{c=2}\nC]{style=x}";
  const document = parseSource(source);
  assert.equal(toPlainText(document), "A[B]\nC");
  assert.equal(serializeSource(document), "[[A\\[B\\]]{c=2}\nC]{style=x}");
  assert.deepEqual(parseSource(serializeSource(document)), document);
});

test("all editor presentation outputs close under parse and serialize", () => {
  const sources = ["本文", "如何《どう》\n本文", "[ABCDE]{c=2}", "か\u3099👨‍👩‍👧‍👦葛\uDB40\uDD00"];
  for (const source of sources) {
    const base = parseSource(source);
    const edited = applyPresentation(base, { start: 0, end: Math.max(1, nodeLength(base.nodes[0])) }, { style: { type: "style", name: "x" } });
    const serialized = serializeSource(edited);
    assert.deepEqual(parseSource(serialized), parseSource(serializeSource(parseSource(serialized))));
  }
});

test("selection boundaries are grapheme-safe", () => {
  const value = "か\u3099👨‍👩‍👧‍👦葛\uDB40\uDD00";
  assert.equal(graphemes(value).length, 3);
  assert.equal(nodeLength({ type: "text", value }), 3);
  const edited = applyPresentation(parseSource(value), { start: 1, end: 2 }, { combine: true });
  assert.equal(toPlainText(edited), value);
  assert.equal(serializeSource(edited), "か\u3099[👨‍👩‍👧‍👦]{combine}葛\uDB40\uDD00");
});

test("parser limits hostile nesting and attribute counts", () => {
  let nested = "x";
  for (let i = 0; i < 40; i++) nested = `[${nested}]{c=2}`;
  assert.throws(() => parseSource(nested), /入れ子が深すぎ/);
  assert.throws(() => parseSource("[x]{" + Array.from({ length: 17 }, (_, i) => `c=${i}`).join(",") + "}"), /属性が多すぎ/);
});

test("parser fuzz corpus terminates without leaking malformed state", () => {
  let seed = 0x12345678;
  const alphabet = "[]{}\\\\｜《》ABCあいう\n";
  for (let round = 0; round < 250; round++) {
    let source = "";
    for (let i = 0; i < 80; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; source += alphabet[seed % alphabet.length]; }
    assert.doesNotThrow(() => { try { const parsed = parseSource(source); parseSource(serializeSource(parsed)); } catch (error) { assert.match(String(error), /Presentation|Source|属性|要素|入れ子/); } });
  }
});
