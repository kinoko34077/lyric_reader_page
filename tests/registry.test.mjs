import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRegistry, resolvePresentation, validateRegistry } from "../assets/js/registry.js";

const registry = { palettes: { "0": "#111111", "2": "#d02020" }, styles: { shout: { color: 2 } }, glyphs: { hare: { text: "晴" } } };

test("registry validates only the supported data shape", () => {
  assert.equal(validateRegistry(registry).valid, true);
  assert.equal(validateRegistry({ palettes: { "2": "red" } }).valid, false);
  assert.equal(validateRegistry({ styles: { "bad name": { color: 2 } } }).valid, false);
  assert.equal(validateRegistry({ glyphs: { hare: { html: "<svg>" } } }).valid, true);
});

test("presentation references resolve through registries", () => {
  const result = resolvePresentation({ color: { type: "palette", index: 2 }, style: { type: "style", name: "shout" }, glyph: { type: "glyph", name: "hare" }, combine: true }, registry);
  assert.deepEqual(result, { color: "#d02020", glyphText: "晴", combine: true, styleName: "shout" });
});

test("missing glyph falls back without throwing", () => {
  const result = resolvePresentation({ glyph: { type: "glyph", name: "missing" } }, normalizeRegistry({}));
  assert.equal(result.glyphText, null);
});
