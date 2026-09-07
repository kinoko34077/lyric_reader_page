const HEX = /^#[0-9a-f]{6}$/i;
const NAME = /^[\w-]+$/;

function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function paletteValue(palettes, index) {
  const source = Array.isArray(palettes) ? palettes[index] : record(palettes)[String(index)];
  return typeof source === "string" && HEX.test(source) ? source : null;
}

export function validateRegistry(registry = {}) {
  const errors = [];
  const value = record(registry);
  for (const [index, color] of Object.entries(record(value.palettes))) {
    if (!/^\d+$/.test(index) || typeof color !== "string" || !HEX.test(color)) errors.push(`Palette ${index} が不正です。`);
  }
  for (const [name, style] of Object.entries(record(value.styles))) {
    if (!NAME.test(name) || !style || typeof style !== "object" || Array.isArray(style)) errors.push(`Style ${name} が不正です。`);
    if (style?.color !== undefined && !/^\d+$/.test(String(style.color))) errors.push(`Style ${name} のcolor参照が不正です。`);
  }
  for (const [name, glyph] of Object.entries(record(value.glyphs))) {
    if (!NAME.test(name) || !glyph || typeof glyph !== "object" || Array.isArray(glyph)) errors.push(`Glyph ${name} が不正です。`);
    if (glyph?.text !== undefined && typeof glyph.text !== "string") errors.push(`Glyph ${name} のfallback文字列が不正です。`);
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeRegistry(registry = {}) {
  const value = record(registry);
  return {
    palettes: record(value.palettes), styles: record(value.styles), glyphs: record(value.glyphs),
    fonts: record(value.fonts), gradients: record(value.gradients), outlines: record(value.outlines)
  };
}

export function resolvePresentation(presentation = {}, registry = {}) {
  const normalized = normalizeRegistry(registry);
  const resolved = {};
  const style = presentation.style ? normalized.styles[presentation.style.name] : null;
  const paletteIndex = presentation.color?.index ?? (style && /^\d+$/.test(String(style.color)) ? Number(style.color) : 0);
  resolved.color = paletteValue(normalized.palettes, paletteIndex);
  resolved.glyphText = presentation.glyph ? normalized.glyphs[presentation.glyph.name]?.text || null : null;
  resolved.combine = Boolean(presentation.combine);
  resolved.styleName = presentation.style?.name || null;
  return resolved;
}
