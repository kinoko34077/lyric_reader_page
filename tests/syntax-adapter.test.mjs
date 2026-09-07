import test from "node:test";
import assert from "node:assert/strict";
import { parseSource, serializeSource, toPlainText, toPortableText, validateSource } from "../assets/js/syntax-adapter.js";

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
