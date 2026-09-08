import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRegistry, paletteValue, renameStyleInDocument, resolvePresentation, validateRegistry } from "../assets/js/registry.js";

const registry = {
  banks: {
    default: { slots: { 0: { color: "#111111", name: "foreground" }, 2: { color: "#d02020", name: "chorus-red" }, 3: "#00aaee" } },
    night: { slots: { 0: "#eeeeee", 1: "#101010", 2: "#44cc88" } }
  },
  activeBank: "default",
  styles: {
    base: { color: 2, outline: "thin" },
    shout: { extends: "base", weight: "700", combine: "parallel" },
    conflictA: { color: 2, weight: "700" },
    conflictB: { color: 3, weight: "400" }
  },
  glyphs: {
    hare: { type: "text", text: "晴" },
    svg: { type: "svg", src: "https://example.com/hare.svg" },
    image: { type: "image", src: "./hare.png" },
    font: { type: "font", font: "nishiki", glyph: "hare" }
  },
  fonts: { nishiki: { type: "remote", url: "https://example.com/nishiki.woff2" } },
  outlines: { thin: { width: 0.08, color: 3 }, layered: [{ width: 0.12, color: 2 }, { width: 0.04, color: 3 }] },
  gradients: { fire: { direction: "to-inline-end", stops: [{ at: 0, palette: 2 }, { at: 1, color: "#ffee00" }] } }
};

test("registry validates supported data-only definitions and rejects executable fields", () => {
  assert.equal(validateRegistry(registry).valid, true);
  assert.equal(validateRegistry({ scripts: "alert(1)" }).valid, false);
  assert.equal(validateRegistry({ glyphs: { hare: { html: "<svg>" } } }).valid, false);
  assert.equal(validateRegistry({ fonts: { remote: { type: "remote", url: "javascript:alert(1)" } } }).valid, false);
  assert.equal(validateRegistry({ styles: { unsafe: { weight: "700;color:red" } } }).valid, false);
});

test("Palette 0/1 are always present and missing slots fall back to Palette 1", () => {
  const normalized = normalizeRegistry({});
  assert.equal(normalized.banks.default.slots["0"], "#ffffff");
  assert.equal(normalized.banks.default.slots["1"], "#000000");
  assert.equal(paletteValue(normalized, 999), "#000000");
  assert.equal(resolvePresentation({ color: { type: "palette", index: 999 } }, {}).color, "#000000");
});

test("Palette Bank, named slots, and explicit Bank references resolve deterministically", () => {
  const normalized = normalizeRegistry(registry);
  assert.equal(normalized.paletteNames["0"], "foreground");
  assert.equal(paletteValue(normalized, 2, "night"), "#44cc88");
  assert.equal(resolvePresentation({ bank: { type: "palette-bank", name: "night" }, color: { type: "palette", index: 2 } }, registry).color, "#44cc88");
  assert.equal(resolvePresentation({ color: { type: "palette", index: 999 } }, registry).color, "#000000");
  assert.equal(normalizeRegistry({ palettes: { 0: "#fff", 1: "#000" }, paletteNames: { 0: "foreground" } }).paletteNames[0], "foreground");
  assert.equal(normalizeRegistry({ banks: { night: { slots: { 0: "#eeeeee" }, names: { 0: "paper" } } } }).banks.night.names[0], "paper");
});

test("Named Style inheritance is arbitrary-depth and direct properties win", () => {
  const result = resolvePresentation({ style: { type: "style", name: "shout" }, color: { type: "palette", index: 3 } }, registry);
  assert.equal(result.color, "#00aaee");
  assert.equal(result.weight, "700");
  assert.deepEqual(result.combine, { type: "combine", mode: "parallel" });
  assert.deepEqual(result.outlines, [{ width: 0.08, color: "#00aaee" }]);
});

test("Style cycles and missing inheritance are rejected before resolution", () => {
  const cycle = validateRegistry({ styles: { a: { extends: "b" }, b: { extends: "a" } } });
  assert.equal(cycle.valid, false);
  assert.ok(cycle.errors.some(error => error.includes("循環")));
  assert.equal(validateRegistry({ styles: { a: { extends: "missing" } } }).valid, false);
});

test("Multiple Named Styles expose conflicts instead of silently using last-wins", () => {
  const result = resolvePresentation({ styles: [{ type: "style", name: "conflictA" }, { type: "style", name: "conflictB" }] }, registry);
  assert.deepEqual(result.styleNames, ["conflictA", "conflictB"]);
  assert.equal(result.conflicts.some(conflict => conflict.property === "color"), true);
  assert.equal(result.conflicts.some(conflict => conflict.property === "weight"), true);
  assert.deepEqual(result.conflictColors, ["#d02020", "#00aaee"]);
});

test("multiple outlines and Registry HEX gradient stops resolve without palette coercion", () => {
  const result = resolvePresentation({ style: { type: "style", name: "base" }, outline: { type: "outline", name: "layered" }, gradient: { type: "gradient", name: "fire" } }, registry);
  assert.deepEqual(result.outlines, [{ width: 0.12, color: "#d02020" }, { width: 0.04, color: "#00aaee" }]);
  assert.equal(result.gradient.direction, "to-inline-end");
  assert.equal(result.gradient.fallbackColor, "#111111");
  assert.deepEqual(result.gradient.stops, [{ position: 0, color: "#d02020" }, { position: 1, color: "#ffee00" }]);
  assert.deepEqual(resolvePresentation({ outline: { type: "outline", name: "hex" } }, { outlines: { hex: { width: 0.1, color: "#abcdef" } } }).outlines, [{ width: 0.1, color: "#abcdef" }]);
});

test("Glyph text, SVG, image, and font definitions stay typed and missing assets warn", () => {
  assert.equal(resolvePresentation({ glyph: { type: "glyph", name: "hare" } }, registry).glyphText, "晴");
  assert.equal(resolvePresentation({ glyph: { type: "glyph", name: "svg" } }, registry).glyph.type, "svg");
  assert.equal(resolvePresentation({ glyph: { type: "glyph", name: "image" } }, registry).glyph.type, "image");
  assert.equal(resolvePresentation({ glyph: { type: "glyph", name: "font" } }, registry).glyph.type, "font");
  const missing = resolvePresentation({ glyph: { type: "glyph", name: "missing" } }, registry);
  assert.equal(missing.glyph, null); assert.equal(missing.glyphText, null); assert.equal(missing.warnings.length > 0, true);
  assert.equal(resolvePresentation({ glyph: { type: "glyph", name: "font" } }, registry).font.family, "ReaderFont-nishiki");
  assert.equal(normalizeRegistry({ glyphs: { text: "置換" } }).glyphs.text.text, "置換");
});

test("Registry resolution exposes concrete Style, Glyph, and Font definitions", () => {
  const result = resolvePresentation({ style: { type: "style", name: "shout" }, glyph: { type: "glyph", name: "font" }, font: { type: "font", name: "nishiki" } }, registry);
  assert.deepEqual(result.styleDefinitions, [{ name: "shout", definition: { weight: "700", combine: { type: "combine", mode: "parallel" }, extends: ["base"] } }]);
  assert.deepEqual(result.glyphAsset, { type: "font", font: "nishiki", glyph: "hare" });
  assert.deepEqual(result.fontDefinition, { type: "remote", url: "https://example.com/nishiki.woff2" });
});

test("style inheritance has a bounded depth and does not recurse forever", () => {
  const styles = {};
  for (let index = 0; index < 66; index++) styles[`s${index}`] = index ? { extends: `s${index - 1}` } : {};
  const result = validateRegistry({ styles });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("深すぎ")));
});

test("Presentation resolution reports missing styles, banks, and palette slots", () => {
  const result = resolvePresentation({ styles: [{ type: "style", name: "missing" }], bank: { type: "palette-bank", name: "missing-bank" }, color: { type: "palette", index: 99 } }, registry);
  assert.equal(result.warnings.some(warning => warning.includes("Style missing")), true);
  assert.equal(result.warnings.some(warning => warning.includes("Palette Bank missing-bank")), true);
  assert.equal(result.warnings.some(warning => warning.includes("Slot 1へFallback")), true);
});

test("Style rename is one transaction across Registry, Source, links, and overrides", () => {
  const source = { registry: { styles: { shout: { color: 2 } } }, content: { format: "narou-text", variants: [{ id: "a", source: { text: "[声:style=shout]" }, presentation: { style: { type: "style", name: "shout" } }, overrides: { x: { style: { type: "style", name: "shout" } } } }], variantOverrides: { a: { x: { styles: [{ type: "style", name: "shout" }] } } } }, links: [{ presentation: { style: { type: "style", name: "shout" } } }], variantOverrides: { a: { x: { styles: [{ type: "style", name: "shout" }] } } } };
  const renamed = renameStyleInDocument(source, "shout", "scream");
  assert.equal(renamed.registry.styles.shout, undefined);
  assert.deepEqual(renamed.registry.styles.scream, { color: 2 });
  assert.equal(renamed.content.variants[0].source.text, "[声:style=scream]");
  assert.equal(renamed.links[0].presentation.style.name, "scream");
  assert.equal(renamed.variantOverrides.a.x.styles[0].name, "scream");
  assert.equal(renamed.content.variants[0].presentation.style.name, "scream");
  assert.equal(renamed.content.variants[0].overrides.x.style.name, "scream");
  assert.equal(renamed.content.variantOverrides.a.x.styles[0].name, "scream");
  assert.equal(source.content.variants[0].source.text, "[声:style=shout]");
});

test("Registry key validation rejects prototype-sensitive names and oversized asset collections", () => {
  const styles = Object.create(null); styles.__proto__ = { color: 2 };
  assert.equal(validateRegistry({ styles }).valid, false);
  const glyphs = Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`g${index}`, { type: "text", text: "x" }]));
  assert.equal(validateRegistry({ glyphs }).valid, false);
});
