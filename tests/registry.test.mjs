import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRegistry, resolvePresentation, validateRegistry } from "../assets/js/registry.js";

const registry = { palettes: { "0": "#111111", "2": "#d02020" }, styles: { shout: { color: 2 } }, glyphs: { hare: { text: "晴" } } };

test("registry validates only the supported data shape", () => {
  assert.equal(validateRegistry(registry).valid, true);
  assert.equal(validateRegistry({ palettes: { "2": "red" } }).valid, false);
  assert.equal(validateRegistry({ styles: { "bad name": { color: 2 } } }).valid, false);
  assert.equal(validateRegistry({ glyphs: { hare: { html: "<svg>" } } }).valid, false);
});

test("presentation references resolve through registries", () => {
  const result = resolvePresentation({ color: { type: "palette", index: 2 }, style: { type: "style", name: "shout" }, glyph: { type: "glyph", name: "hare" }, combine: true }, registry);
  assert.deepEqual(result, { color: "#d02020", glyphText: "晴", combine: true, styleName: "shout" });
});

test("missing glyph falls back without throwing", () => {
  const result = resolvePresentation({ glyph: { type: "glyph", name: "missing" } }, normalizeRegistry({}));
  assert.equal(result.glyphText, null);
});

test("registry normalization drops unsupported containers without executing them", () => {
  const result = normalizeRegistry({ palettes: { "0": "#111111" }, scripts: "alert(1)", html: "<style>" });
  assert.deepEqual(result, { palettes: { "0": "#111111" }, styles: {}, glyphs: {}, fonts: {}, gradients: {}, outlines: {} });
});

test("registry rejects unknown fields, bad references, and oversized collections", () => {
  assert.equal(validateRegistry({ scripts: "alert(1)" }).valid, false);
  assert.equal(validateRegistry({ styles: { bad: { color: 9 } }, palettes: { "0": "#111111" } }).valid, false);
  assert.equal(validateRegistry({ palettes: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [String(index), "#111111"])) }).valid, false);
});

test("outline and gradient references resolve only through validated registry data", () => {
  const styled = { ...registry, palettes: { ...registry.palettes, "3": "#00aaee" }, outlines: { thin: { width: 2, color: 3 } }, gradients: { fire: { direction: "to-right", stops: [{ at: 0, palette: 2 }, { at: 1, palette: 3 }] } }, styles: { shout: { color: 2, outline: "thin", gradient: "fire" } } };
  assert.equal(validateRegistry(styled).valid, true);
  const result = resolvePresentation({ style: { type: "style", name: "shout" } }, styled);
  assert.deepEqual(result.outline, { width: 2, color: "#00aaee" });
  assert.deepEqual(result.gradient, { direction: "to-right", stops: [{ position: 0, color: "#d02020" }, { position: 1, color: "#00aaee" }] });
  assert.equal(validateRegistry({ palettes: { "0": "#111111" }, outlines: { bad: { width: 99, color: 0 } } }).valid, false);
});

test("registry references stay data-only and can be restored as a history value", () => {
  const source = { registry: { palettes: { "1": "#d02020" } } };
  const snapshot = structuredClone(source);
  source.registry.palettes["1"] = "#000000";
  assert.equal(snapshot.registry.palettes["1"], "#d02020");
});
