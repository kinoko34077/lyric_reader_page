import test from "node:test";
import assert from "node:assert/strict";
import { applyPresentation, applyRubyPresentation, assertCapabilities, clearPresentation, detectSyntaxAdapter, graphemes, getSyntaxAdapter, isSafePresentationName, legacyNarouTextAdapter, narouTextAdapter, nodeLength, parseSource, replaceText, serializeSource, toPlainText, toPortableText, toPortableTextSafe, validateSource } from "../assets/js/syntax-adapter.js";
import { rawText } from "../assets/js/reader-view.js";

test("vNext provisional markup becomes typed presentation IR", () => {
  const document = parseSource("[如何《どう》:c=2,style=title]\n[12:combine]\n[晴:glyph=hare-special]");
  assert.equal(document.type, "document");
  assert.deepEqual(document.nodes[0].presentation.color, { type: "palette", index: 2 });
  assert.deepEqual(document.nodes[0].presentation.style, { type: "style", name: "title" });
  assert.equal(document.nodes[0].children[0].type, "ruby");
  assert.deepEqual(document.nodes[2].presentation.combine, { type: "combine", mode: "straight" });
});

test("author serialization round-trips while portable projections remove presentation", () => {
  const source = "[如何《どう》:c=2]\n[12:combine]\n[晴:glyph=hare-special]";
  const document = parseSource(source);
  assert.equal(serializeSource(document), source);
  assert.equal(toPortableText(document), "如何《どう》\n12\n晴");
  assert.equal(toPlainText(document), "如何\n12\n晴");
});

test("safe Portable projection preserves malformed Source instead of throwing", () => {
  assert.equal(toPortableTextSafe("[本文:c=bad]"), "[本文:c=bad]");
  assert.equal(toPortableTextSafe("[本文:c=2]"), "本文");
});

test("known invalid attributes fail validation while unknown extensions remain literal", () => {
  assert.equal(validateSource("[文字:c=bad]").valid, false);
  assert.equal(validateSource("[文字:style=bad name]").valid, false);
  assert.equal(validateSource("[文字:style=__proto__]").valid, false);
  assert.equal(validateSource("[文字:weight=700;color:red]").valid, false);
  assert.equal(validateSource("[文字:c=2,combine]").valid, true);
  const unknown = "[文字:future=opaque]";
  assert.equal(toPlainText(parseSource(unknown)), unknown);
  assert.equal(serializeSource(parseSource(unknown)), "\\[文字:future=opaque\\]");
});

test("plain ruby and text remain compatible", () => {
  const document = parseSource("如何《どう》\n通常文");
  assert.equal(serializeSource(document), "如何《どう》\n通常文");
  assert.equal(toPortableText(document), "如何《どう》\n通常文");
});

test("presentation editing changes Author Source while Portable Text stays semantic", () => {
  const document = parseSource("如何《どう》\n本文");
  const edited = applyPresentation(document, { start: 0, end: 2 }, { color: { type: "palette", index: 2 } });
  assert.equal(serializeSource(edited), "[如何《どう》:c=2]\n本文");
  assert.equal(toPortableText(edited), "如何《どう》\n本文");
  assert.deepEqual(parseSource(serializeSource(edited)), edited);
});

test("repeated Style commands accumulate on one span and remain parseable", () => {
  const initial = parseSource("ABCDE");
  const first = applyPresentation(initial, { start: 0, end: 5 }, { style: { type: "style", name: "first" } });
  const second = applyPresentation(first, { start: 0, end: 5 }, { style: { type: "style", name: "second" } });
  assert.deepEqual(second.nodes[0].presentation.styles, [{ type: "style", name: "first" }, { type: "style", name: "second" }]);
  const source = serializeSource(second);
  assert.deepEqual(parseSource(source), second);
  assert.deepEqual(parseSource("[x:style=first,style=first]").nodes[0].presentation.style, { type: "style", name: "first" });
});

test("clearing a range unwraps presentation without changing source text", () => {
  const document = parseSource("A[如何《どう》:c=2]B");
  const cleared = clearPresentation(document, { start: 1, end: 3 });
  assert.equal(serializeSource(cleared), "A如何《どう》B");
  assert.equal(toPortableText(cleared), "A如何《どう》B");
});

test("partial Ruby selection keeps the Ruby node intact until Ruby-part editing is available", () => {
  const document = parseSource("如何《どう》");
  const edited = applyPresentation(document, { start: 0, end: 1 }, { combine: { type: "combine", mode: "straight" } });
  assert.equal(serializeSource(edited), "[如何《どう》:base-range=0-1,base-combine]");
  assert.equal(toPortableText(edited), "如何《どう》");
});

test("Ruby base and Ruby text have independent grapheme presentation ranges", () => {
  const baseSource = "[如何《どう》:base-range=0-1,base-c=2]";
  const baseDocument = parseSource(baseSource);
  assert.equal(baseDocument.nodes[0].type, "ruby");
  assert.deepEqual(baseDocument.nodes[0].baseDecorations[0], { start: 0, end: 1, presentation: { color: { type: "palette", index: 2 } } });
  assert.equal(serializeSource(baseDocument), baseSource);
  assert.deepEqual(parseSource(serializeSource(baseDocument)), baseDocument);

  const rubyDocument = applyRubyPresentation(parseSource("如何《どう》"), { nodeIndex: 0, part: "ruby", start: 0, end: 1 }, { color: { type: "palette", index: 3 } });
  assert.equal(serializeSource(rubyDocument), "[如何《どう》:ruby-range=0-1,ruby-c=3]");
  assert.equal(toPortableText(rubyDocument), "如何《どう》");
  assert.deepEqual(parseSource(serializeSource(rubyDocument)), rubyDocument);
});

test("multiple Ruby-part ranges remain closed through nested serialization", () => {
  let document = parseSource("如何《どう》");
  document = applyRubyPresentation(document, { nodeIndex: 0, part: "base", start: 0, end: 1 }, { color: { type: "palette", index: 2 } });
  document = applyRubyPresentation(document, { nodeIndex: 0, part: "base", start: 1, end: 2 }, { style: { type: "style", name: "x" } });
  const serialized = serializeSource(document);
  assert.deepEqual(parseSource(serialized), document);
});

test("Ruby-part copy projection keeps the original portable Ruby", () => {
  const document = parseSource("前｜如何《どう》後");
  assert.equal(rawText(document.nodes, { ruby: { nodeIndex: 0, part: "ruby", start: 0, end: 1 } }), "｜如何《どう》");
});

test("semantic text insertion stays outside an adjacent Ruby and inside Presentation", () => {
  const ruby = parseSource("前｜如何《どう》後");
  const afterRuby = replaceText(ruby, { start: 3, end: 3 }, "A");
  assert.equal(serializeSource(afterRuby), "前｜如何《どう》A後");
  assert.deepEqual(parseSource(serializeSource(afterRuby)), afterRuby);

  const styled = replaceText(parseSource("[AB:c=2]"), { start: 1, end: 1 }, "X");
  assert.equal(serializeSource(styled), "[AXB:c=2]");
  assert.deepEqual(parseSource(serializeSource(styled)), styled);
});

test("semantic text replacement preserves surrounding Ruby and Presentation nodes", () => {
  const document = parseSource("前[如何《どう》:c=2]後");
  const edited = replaceText(document, { start: 0, end: 1 }, "先");
  assert.equal(serializeSource(edited), "先[如何《どう》:c=2]後");
  assert.equal(toPortableText(edited), "先如何《どう》後");
});

test("presentation registry names share the parser safety contract", () => {
  assert.equal(isSafePresentationName("chorus-2"), true);
  assert.equal(isSafePresentationName("__proto__"), false);
  assert.equal(isSafePresentationName("constructor"), false);
  assert.equal(isSafePresentationName("prototype"), false);
});

test("partial presentation application splits a span without duplicating source", () => {
  const edited = applyPresentation(parseSource("[ABCDE:c=2]"), { start: 1, end: 3 }, { style: { type: "style", name: "x" } });
  assert.equal(serializeSource(edited), "[A:c=2][BC:c=2,style=x][DE:c=2]");
  assert.equal(toPlainText(edited), "ABCDE");
  assert.equal((toPlainText(edited).match(/A|B|C|D|E/g) || []).length, 5);
});

test("partial presentation clearing preserves the untouched presentation sides", () => {
  const cleared = clearPresentation(parseSource("[ABCDE:c=2]"), { start: 1, end: 3 });
  assert.equal(serializeSource(cleared), "[A:c=2]BC[DE:c=2]");
  assert.equal(toPortableText(cleared), "ABCDE");
});

test("partial Ruby clearing removes only the selected base decoration", () => {
  const source = "[如何《どう》:base-range=0-2,base-c=2]";
  const cleared = clearPresentation(parseSource(source), { start: 0, end: 1 });
  assert.equal(serializeSource(cleared), "[如何《どう》:base-range=1-2,base-c=2]");
  assert.equal(toPortableText(cleared), "如何《どう》");
});

test("Ruby presentation ranges are bounded and full clearing removes scoped decorations", () => {
  assert.throws(() => parseSource("[如何《どう》:base-range=0-3,base-c=2]"), /親文字範囲/);
  const document = parseSource("[如何《どう》:base-range=0-2,base-c=2,ruby-range=0-2,ruby-c=3]");
  const cleared = clearPresentation(document, { start: 0, end: 2 });
  assert.equal(serializeSource(cleared), "如何《どう》");
  assert.deepEqual(parseSource(serializeSource(cleared)), cleared);
});

test("local syntax detection selects the legacy adapter without misclassifying vNext", () => {
  assert.equal(detectSyntaxAdapter("[文字]{c=2}").id, "narou-legacy");
  assert.equal(detectSyntaxAdapter("[文字:c=2]").id, "narou-text");
  assert.equal(detectSyntaxAdapter("通常の[角括弧]と{本文}").id, "narou-text");
});

test("adapter router isolates legacy syntax from the vNext default", () => {
  assert.equal(getSyntaxAdapter("narou-text").id, "narou-text");
  assert.equal(getSyntaxAdapter("narou").id, "narou-legacy");
  assert.equal(serializeSource(parseSource("[文字]{c=2}", legacyNarouTextAdapter), legacyNarouTextAdapter), "[文字]{c=2}");
  assert.throws(() => getSyntaxAdapter("unknown-format"), /未対応の本文format/);
});

test("adapter capabilities are negotiated explicitly", () => {
  assert.equal(assertCapabilities(narouTextAdapter, { ruby: true, escapedLiterals: true, multilinePresentation: true }), narouTextAdapter);
  assert.throws(() => assertCapabilities({ capabilities: { ruby: true } }, { gradient: true }), /gradientに対応/);
});

test("parser accepts newlines, escaped literals, and nested input", () => {
  const source = "[A\\[B\\]:c=2\n,style=x]";
  const document = parseSource(source);
  assert.equal(toPlainText(document), "A[B]");
  assert.deepEqual(parseSource(serializeSource(document)), document);
  assert.equal(serializeSource(document), "[A\\[B\\]:c=2,style=x]");
});

test("Ruby delimiters and colons remain escaped inside a multiline presentation target", () => {
  const source = "[｜a:b《c:d》\n本文:c=2]";
  assert.deepEqual(parseSource(serializeSource(parseSource(source))), parseSource(source));
});

test("nested presentation preserves the typed nesting", () => {
  const source = "[[BC:c=2]:style=outer]";
  const document = parseSource(source);
  assert.equal(document.nodes[0].presentation.style.name, "outer");
  assert.equal(document.nodes[0].children[0].presentation.color.index, 2);
  assert.equal(serializeSource(document), source);
  assert.deepEqual(parseSource(serializeSource(document)), document);
});

test("nested presentation keeps the inner property more local than the outer property", () => {
  const edited = applyPresentation(parseSource("[[AB:c=2]:style=outer]"), { start: 0, end: 1 }, { color: { type: "palette", index: 3 } });
  assert.equal(serializeSource(edited), "[A:c=3,style=outer][[B:c=2]:style=outer]");
  assert.equal(edited.nodes[0].presentation.style.name, "outer");
  assert.equal(edited.nodes[0].presentation.color.index, 3);
  assert.equal(edited.nodes[1].presentation.style.name, "outer");
  assert.equal(edited.nodes[1].children[0].presentation.color.index, 2);
  assert.deepEqual(parseSource(serializeSource(edited)), edited);
});

test("all editor presentation outputs close under parse and serialize", () => {
  const sources = ["本文", "如何《どう》\n本文", "[ABCDE:c=2]", "か\u3099👨‍👩‍👧‍👦葛\uDB40\uDD00"];
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
  const edited = applyPresentation(parseSource(value), { start: 1, end: 2 }, { combine: { type: "combine", mode: "straight" } });
  assert.equal(toPlainText(edited), value);
  assert.equal(serializeSource(edited), "か\u3099[👨‍👩‍👧‍👦:combine]葛\uDB40\uDD00");
});

test("parser limits hostile nesting and attribute counts", () => {
  let nested = "x";
  for (let i = 0; i < 40; i++) nested = `[${nested}:c=2]`;
  assert.throws(() => parseSource(nested), /入れ子が深すぎ/);
  assert.throws(() => parseSource("[x:" + Array.from({ length: 17 }, () => "style=x").join(",") + "]"), /属性が多すぎ/);
  assert.throws(() => parseSource("[x:base-range=0-1]"), /有効な属性/);
  assert.throws(() => parseSource("[x:base-c=2]"), /対象はRuby/);
});

test("parser fuzz corpus terminates without leaking malformed state", () => {
  let seed = 0x12345678;
  const alphabet = "[]{}\\\\:,=｜《》ABCあいう\\n";
  for (let round = 0; round < 250; round++) {
    let source = "";
    for (let i = 0; i < 80; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; source += alphabet[seed % alphabet.length]; }
    assert.doesNotThrow(() => { try { const parsed = parseSource(source); parseSource(serializeSource(parsed)); } catch (error) { assert.match(String(error), /Presentation|Source|属性|要素|入れ子|Palette|Style|Glyph|Combine|Font|Weight|Outline|Gradient/); } });
  }
});
