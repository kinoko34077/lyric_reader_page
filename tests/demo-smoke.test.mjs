import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseSource, serializeSource, toPortableText } from "../assets/js/syntax-adapter.js";
import { normalizeRegistry, resolvePresentation, validateRegistry } from "../assets/js/registry.js";

const root = path.join(process.cwd(), "data", "demo");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "reader.json"), "utf8"));

test("public demo manifest is a Reader smoke fixture", () => {
  assert.equal(manifest.version, 3);
  assert.equal(manifest.content.format, "narou-text");
  assert.ok(Array.isArray(manifest.content.variants));
  assert.ok(manifest.content.variants.length >= 2);
  assert.equal(validateRegistry(manifest.registry).valid, true);

  const original = manifest.content.variants.find(variant => variant.id === "original");
  assert.ok(original?.src);
  const source = fs.readFileSync(path.resolve(root, original.src), "utf8");
  const document = parseSource(source);
  assert.deepEqual(parseSource(serializeSource(document)), document);

  for (const marker of [
    "style=demo-title",
    "c=2",
    "bank=night",
    "outline=thin",
    "combine=parallel",
    "combine=z",
    "glyph=hare",
    "glyph=missing-svg",
    "glyph=font-hare",
    "style=missing-style",
    "font=missing-font"
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `demo must exercise ${marker}`);

  const normalized = normalizeRegistry(manifest.registry);
  assert.equal(normalized.banks.night.slots["2"], "#54c28a");
  assert.deepEqual(resolvePresentation({ style: { type: "style", name: "demo-title" } }, manifest.registry).outlines, [{ width: 0.08, color: "#236ca3" }]);
  assert.match(toPortableText(document), /晴々撥条/);
});

test("public demo deliberately exercises source fallback assets", () => {
  const missingSvg = manifest.registry.glyphs["missing-svg"];
  assert.equal(missingSvg.type, "svg");
  assert.equal(fs.existsSync(path.resolve(root, missingSvg.src)), false);
  assert.equal(manifest.registry.fonts["missing-font"].type, "remote");
});
