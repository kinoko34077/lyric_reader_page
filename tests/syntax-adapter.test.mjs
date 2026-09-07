import test from "node:test";
import assert from "node:assert/strict";
import { applyPresentation, clearPresentation, parseSource, serializeSource, toPlainText, toPortableText, validateSource } from "../assets/js/syntax-adapter.js";

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
  const edited = applyPresentation(document, { start: 0, end: 3 }, { color: { type: "palette", index: 2 } });
  assert.equal(serializeSource(edited), "[如何《どう》\n]{c=2}本文");
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
  assert.equal(serializeSource(edited), "[A]{c=2}[BC]{style=x}[DE]{c=2}");
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
