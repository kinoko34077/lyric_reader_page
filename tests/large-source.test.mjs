import test from "node:test";
import assert from "node:assert/strict";
import { parseSource, serializeSource, toPlainText, toPortableText } from "../assets/js/syntax-adapter.js";

test("large mixed source preserves Author Source and projections", () => {
  const lines = Array.from({ length: 5000 }, (_, index) => {
    const ruby = `如何《どう${index % 10}》`;
    const presentation = index % 4 === 0 ? `[${ruby}]{c=2,style=shout}` : index % 4 === 1 ? `[${index % 100}]{combine}` : index % 4 === 2 ? `[晴]{glyph=hare-special}` : ruby;
    return `${index}: ${presentation} 通常文`;
  });
  const source = lines.join("\n");
  const document = parseSource(source);
  assert.equal(serializeSource(document), source);
  const portable = toPortableText(document);
  const plain = toPlainText(document);
  assert.equal(portable.includes("{c="), false);
  assert.equal(portable.includes("{style="), false);
  assert.equal(portable.includes("{combine}"), false);
  assert.equal(portable.includes("{glyph="), false);
  assert.equal((portable.match(/《/g) || []).length, 2500);
  assert.equal(plain.includes("《"), false);
  assert.equal(plain.split("\n").length, 5000);
});

test("many adjacent presentation nodes do not merge or disappear", () => {
  const source = Array.from({ length: 2000 }, (_, index) => `[${index % 10}]{combine}`).join("");
  const document = parseSource(source);
  assert.equal(document.nodes.length, 2000);
  assert.equal(serializeSource(document), source);
  assert.equal(toPortableText(document), "0123456789".repeat(200));
});
