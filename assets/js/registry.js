const HEX = /^#[0-9a-f]{6}$/i;
const NAME = /^[\w-]+$/;
const MAX_ENTRIES = 128;
const MAX_REGISTRY_BYTES = 512_000;
const MAX_GLYPH_TEXT_LENGTH = 4_096;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TOP_LEVEL = new Set(["palettes", "styles", "glyphs", "fonts", "gradients", "outlines"]);
const DIRECTIONS = new Set(["to-right", "to-left", "to-top", "to-bottom", "to-inline-start", "to-inline-end"]);

function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function paletteValue(palettes, index) {
  const source = Array.isArray(palettes) ? palettes[index] : record(palettes)[String(index)];
  return typeof source === "string" && HEX.test(source) ? source : null;
}

export function validateRegistry(registry = {}) {
  const errors = [];
  const value = record(registry);
  try { if (JSON.stringify(value).length > MAX_REGISTRY_BYTES) errors.push("Registryが大きすぎます。"); } catch { errors.push("Registryの形式が不正です。"); }
  for (const key of Object.keys(value)) if (!TOP_LEVEL.has(key)) errors.push(`Registryの項目${key}は未対応です。`);
  const palettes = Array.isArray(value.palettes) ? Object.fromEntries(value.palettes.map((item, index) => [String(index), item])) : record(value.palettes);
  if (Object.keys(palettes).length > MAX_ENTRIES) errors.push("Palette定義が多すぎます。");
  for (const [index, color] of Object.entries(palettes)) {
    if (!/^\d+$/.test(index) || typeof color !== "string" || !HEX.test(color)) errors.push(`Palette ${index} が不正です。`);
  }
  for (const [name, style] of Object.entries(record(value.styles))) {
    if (RESERVED_KEYS.has(name) || !NAME.test(name) || !style || typeof style !== "object" || Array.isArray(style)) errors.push(`Style ${name} が不正です。`);
    if (style && typeof style === "object") for (const key of Object.keys(style)) if (!["color", "font", "weight", "outline", "gradient"].includes(key)) errors.push(`Style ${name} の${key}は未対応です。`);
    if (style?.color !== undefined && !/^\d+$/.test(String(style.color))) errors.push(`Style ${name} のcolor参照が不正です。`);
    if (style?.color !== undefined && palettes[String(style.color)] === undefined && Number(style.color) !== 0) errors.push(`Style ${name} のPalette参照が存在しません。`);
    if (style?.outline !== undefined && !NAME.test(String(style.outline))) errors.push(`Style ${name} のOutline参照が不正です。`);
    if (style?.gradient !== undefined && !NAME.test(String(style.gradient))) errors.push(`Style ${name} のGradient参照が不正です。`);
    if (style?.font !== undefined && !NAME.test(String(style.font))) errors.push(`Style ${name} のFont参照が不正です。`);
  }
  for (const [name, glyph] of Object.entries(record(value.glyphs))) {
    if (RESERVED_KEYS.has(name) || !NAME.test(name) || !glyph || typeof glyph !== "object" || Array.isArray(glyph)) errors.push(`Glyph ${name} が不正です。`);
    if (glyph && typeof glyph === "object") for (const key of Object.keys(glyph)) if (key !== "text") errors.push(`Glyph ${name} の${key}は未対応です。`);
    if (glyph?.text !== undefined && (typeof glyph.text !== "string" || glyph.text.length > MAX_GLYPH_TEXT_LENGTH)) errors.push(`Glyph ${name} のfallback文字列が不正です。`);
  }
  for (const [kind, definitions] of Object.entries({ fonts: value.fonts, gradients: value.gradients, outlines: value.outlines })) {
    if (definitions !== undefined && Object.keys(record(definitions)).length > MAX_ENTRIES) errors.push(`${kind}定義が多すぎます。`);
    for (const name of Object.keys(record(definitions))) if (RESERVED_KEYS.has(name) || !NAME.test(name)) errors.push(`${kind}名${name}が不正です。`);
  }
  for (const [name, font] of Object.entries(record(value.fonts))) {
    if (!font || typeof font !== "object" || Array.isArray(font) || font.type !== "remote" || typeof font.url !== "string" || !/^https?:\/\//i.test(font.url)) errors.push(`Font ${name} が不正です。`);
  }
  for (const [name, gradient] of Object.entries(record(value.gradients))) {
    if (!gradient || typeof gradient !== "object" || Array.isArray(gradient) || !DIRECTIONS.has(gradient.direction) || !Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 16) errors.push(`Gradient ${name} が不正です。`);
    for (const stop of gradient?.stops || []) if (!stop || typeof stop !== "object" || !Number.isFinite(Number(stop.at)) || Number(stop.at) < 0 || Number(stop.at) > 1 || !/^\d+$/.test(String(stop.palette)) || (palettes[String(stop.palette)] === undefined && Number(stop.palette) !== 0)) errors.push(`Gradient ${name} のstopが不正です。`);
  }
  for (const [name, outline] of Object.entries(record(value.outlines))) {
    if (!outline || typeof outline !== "object" || Array.isArray(outline) || !Number.isFinite(Number(outline.width)) || Number(outline.width) < 0 || Number(outline.width) > 8 || !/^\d+$/.test(String(outline.color)) || (palettes[String(outline.color)] === undefined && Number(outline.color) !== 0)) errors.push(`Outline ${name} が不正です。`);
  }
  for (const [name, style] of Object.entries(record(value.styles))) {
    if (style?.outline && !record(value.outlines)[style.outline]) errors.push(`Style ${name} のOutline参照が存在しません。`);
    if (style?.gradient && !record(value.gradients)[style.gradient]) errors.push(`Style ${name} のGradient参照が存在しません。`);
    if (style?.font && !record(value.fonts)[style.font]) errors.push(`Style ${name} のFont参照が存在しません。`);
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeRegistry(registry = {}) {
  const value = record(registry);
  return {
    palettes: Array.isArray(value.palettes) ? Object.fromEntries(value.palettes.map((item, index) => [String(index), item])) : record(value.palettes), styles: record(value.styles), glyphs: record(value.glyphs),
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
  const outline = style?.outline ? normalized.outlines[style.outline] : null;
  if (outline) resolved.outline = { width: Number(outline.width), color: paletteValue(normalized.palettes, Number(outline.color)) };
  const gradient = style?.gradient ? normalized.gradients[style.gradient] : null;
  if (gradient) resolved.gradient = { direction: gradient.direction, stops: gradient.stops.map(stop => ({ position: Number(stop.at), color: paletteValue(normalized.palettes, Number(stop.palette)) })).filter(stop => stop.color) };
  const font = style?.font ? normalized.fonts[style.font] : null;
  if (font) resolved.font = { type: "remote", url: font.url, family: `ReaderFont-${style.font}` };
  return resolved;
}
