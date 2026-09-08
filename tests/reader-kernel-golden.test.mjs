import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseSource, serializeSource, toPlainText, toPortableText, validateSource } from "../assets/js/syntax-adapter.js";
import { normalizeRegistry, resolvePresentation, validateRegistry } from "../assets/js/registry.js";
import { glyphFallbackText } from "../assets/js/reader-view.js";

const fixture = fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "reader-kernel-golden.txt"), "utf8");
const registry = {
  palettes: { "0": "#272522", "1": "#000000", "2": "#b52d2d", "3": "#236ca3" },
  styles: { title: { color: 2 }, styled: { color: 3 } },
  glyphs: { hare: { type: "text", text: "晴々" } }
};

test("Golden Source parses, preserves meaning, and closes through serialization", () => {
  validateSource(fixture);
  const document = parseSource(fixture);
  const serialized = serializeSource(document);
  assert.deepEqual(parseSource(serialized), document);
  assert.equal(toPortableText(document).includes("晴々撥条《はれ〴〵バネ》"), true);
  assert.equal(toPortableText(document).includes("style=title"), false);
  assert.equal(toPlainText(document).includes("はれ〴〵バネ"), false);
  assert.equal(toPlainText(document).includes("複数行の\nPresentation対象"), true);
});

test("Golden Source retains Ruby, nested Presentation, Combine, and Glyph semantics", () => {
  const document = parseSource(fixture);
  const serialized = serializeSource(document);
  assert.equal(serialized.includes("glyph=hare"), true);
  assert.equal(serialized.includes("combine=parallel"), true);
  assert.equal(serialized.includes("combine=z"), true);
  assert.equal(serialized.includes("base-range=0-1"), true);
  assert.equal(document.nodes.some(node => node.type === "span" && node.presentation?.style?.name === "title"), true);
  assert.equal(validateRegistry(registry).valid, true);
  assert.equal(resolvePresentation({ style: { type: "style", name: "title" }, glyph: { type: "glyph", name: "hare" } }, registry).glyphText, "晴々");
  assert.equal(normalizeRegistry(registry).banks.default.slots["2"], "#b52d2d");
});

test("Kernel rejects executable Registry input and malformed Source without hanging", () => {
  assert.equal(validateRegistry({ scripts: "alert(1)" }).valid, false);
  assert.throws(() => parseSource("[x:style=\"<script>\"]"), /不正|Literal|Source|属性/);
  const hostile = `[${"[".repeat(40)}x${"]".repeat(40)}:style=x]`;
  assert.doesNotThrow(() => parseSource(hostile));
});

test("Glyph fallback preserves Ruby meaning instead of dropping the reading", () => {
  const node = parseSource("[如何《どう》:glyph=missing]").nodes[0];
  assert.equal(glyphFallbackText(node), "如何《どう》");
});
