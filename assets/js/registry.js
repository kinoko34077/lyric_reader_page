import { getSyntaxAdapter } from "./syntax-adapter.js";

const HEX = /^#[0-9a-f]{6}$/i;
const NAME = /^[\w-]+$/;
const MAX_ENTRIES = 512;
const MAX_REGISTRY_BYTES = 1_000_000;
const MAX_GLYPH_TEXT_LENGTH = 4_096;
const MAX_ASSET_COUNT = 512;
const MAX_ASSET_BYTES = 4_000_000;
const MAX_STYLE_DEPTH = 64;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TOP_LEVEL = new Set(["palettes", "paletteNames", "paletteBanks", "banks", "activeBank", "styles", "glyphs", "fonts", "gradients", "outlines"]);
const STYLE_KEYS = new Set(["color", "bank", "font", "weight", "outline", "gradient", "combine", "extends"]);
const WEIGHT = /^(?:normal|bold|bolder|lighter|[1-9]\d{2})$/i;
const DIRECTIONS = new Set(["to-right", "to-left", "to-top", "to-bottom", "to-inline-start", "to-inline-end"]);
const COMBINE_MODES = new Set(["straight", "parallel", "z"]);

function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function validName(value) { return typeof value === "string" && NAME.test(value) && !RESERVED_KEYS.has(value); }
function clone(value) { return value == null ? value : structuredClone(value); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function safeAssetUrl(value) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) return false;
  try {
    const url = new URL(value, "https://reader.invalid");
    if (url.protocol === "https:") return true;
    return url.origin === "https://reader.invalid" && !/^[a-z][a-z\d+.-]*:/i.test(value);
  } catch { return false; }
}

function safeHttpsUrl(value) {
  if (typeof value !== "string" || !/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function slotValue(value) {
  if (typeof value === "string" && HEX.test(value)) return { color: value.toLowerCase(), name: "" };
  if (!value || typeof value !== "object" || Array.isArray(value) || !HEX.test(String(value.color || ""))) return null;
  return { color: String(value.color).toLowerCase(), name: typeof value.name === "string" ? value.name : "" };
}

function slotContainer(value) {
  if (Array.isArray(value)) return Object.fromEntries(value.map((item, index) => [String(index), item]));
  const source = record(value);
  return source.slots && (Array.isArray(source.slots) || record(source.slots)) ? source.slots : source;
}

function normalizeBank(value, explicitNames = {}) {
  const slots = { "0": "#ffffff", "1": "#000000" }; const names = {};
  for (const [index, raw] of Object.entries(slotContainer(value))) {
    if (!/^\d+$/.test(index)) continue;
    const item = slotValue(raw); if (!item) continue;
    slots[index] = item.color; const name = item.name || explicitNames[index]; if (typeof name === "string" && name.trim()) names[index] = name.trim();
  }
  return { slots, names };
}

function sourceBanks(value) {
  const candidate = record(value.banks || value.paletteBanks);
  const result = {};
  for (const [name, bank] of Object.entries(candidate)) if (validName(name)) { const bankValue = record(bank); result[name] = normalizeBank(bankValue, record(bankValue.names)); }
  if (!Object.keys(result).length || (own(value, "palettes") && !own(candidate, "default"))) result.default = normalizeBank(value.palettes, record(value.paletteNames));
  if (!result.default) result.default = normalizeBank({}, record(value.paletteNames));
  for (const [index, name] of Object.entries(record(value.paletteNames))) if (result.default.slots[index] && typeof name === "string" && name.trim()) result.default.names[index] = name.trim();
  return result;
}

function normalizeColorReference(value) {
  if (Number.isInteger(value) && value >= 0) return { index: value };
  if (typeof value === "string" && /^\d+$/.test(value)) return { index: Number(value) };
  if (value && typeof value === "object" && !Array.isArray(value) && Number.isInteger(Number(value.index)) && Number(value.index) >= 0 && (value.bank === undefined || validName(value.bank))) return { index: Number(value.index), ...(value.bank === undefined ? {} : { bank: value.bank }) };
  return null;
}

function normalizeCombine(value) {
  if (value === true || value == null || value === "straight") return { type: "combine", mode: "straight" };
  if (typeof value === "string" && COMBINE_MODES.has(value)) return { type: "combine", mode: value };
  if (value && typeof value === "object" && COMBINE_MODES.has(value.mode)) return { type: "combine", mode: value.mode };
  return null;
}

function normalizeStyle(value) {
  const source = record(value); const result = {};
  for (const key of STYLE_KEYS) if (source[key] !== undefined) {
    if (key === "color") result.color = clone(source.color);
    else if (key === "extends") result.extends = Array.isArray(source.extends) ? source.extends.filter(validName) : (validName(source.extends) ? [source.extends] : []);
    else if (key === "combine") { const combine = normalizeCombine(source.combine); if (combine) result.combine = combine; }
    else if (key === "weight") result.weight = String(source.weight);
    else result[key] = clone(source[key]);
  }
  return result;
}

function normalizeGlyph(value) {
  if (typeof value === "string") return { type: "text", text: value };
  const source = record(value);
  if (source.type === "text" || (!source.type && typeof source.text === "string")) return { type: "text", text: String(source.text || "") };
  if (source.type === "svg" && safeAssetUrl(source.src || source.url)) return { type: "svg", src: String(source.src || source.url) };
  if (source.type === "image" && safeAssetUrl(source.src || source.url)) return { type: "image", src: String(source.src || source.url) };
  if (source.type === "font" && validName(String(source.font || source.fontId || "")) && String(source.glyph || source.codepoint || "")) return { type: "font", font: String(source.font || source.fontId), glyph: String(source.glyph || source.codepoint) };
  return null;
}

function normalizeGradient(value) {
  const source = record(value); if (!DIRECTIONS.has(source.direction) || !Array.isArray(source.stops) || source.stops.length < 2 || source.stops.length > 32) return null;
  const stops = source.stops.map(stop => {
    if (!stop || typeof stop !== "object") return null;
    const color = HEX.test(String(stop.color || "")) ? String(stop.color).toLowerCase() : null;
    const palette = normalizeColorReference(stop.palette);
    const at = Number(stop.at);
    return Number.isFinite(at) && at >= 0 && at <= 1 && Boolean(palette) !== Boolean(color) ? { at, ...(palette ? { palette } : { color }) } : null;
  }).filter(Boolean);
  return stops.length >= 2 ? { direction: source.direction, stops } : null;
}

function normalizeOutline(value) {
  const layers = Array.isArray(value) ? value : Array.isArray(value?.layers) ? value.layers : [value];
  return layers.map(layer => {
    const source = record(layer); const color = normalizeColorReference(source.color) || (HEX.test(String(source.color || "")) ? String(source.color).toLowerCase() : null);
    return Number.isFinite(Number(source.width)) && Number(source.width) >= 0 && color ? { width: Number(source.width), color } : null;
  }).filter(Boolean);
}

export function normalizeRegistry(registry = {}) {
  const value = record(registry); const banks = sourceBanks(value); const activeBank = validName(value.activeBank) && banks[value.activeBank] ? value.activeBank : "default";
  const styles = {}; for (const [name, definition] of Object.entries(record(value.styles))) if (validName(name)) styles[name] = normalizeStyle(definition);
  const glyphs = {}; for (const [name, definition] of Object.entries(record(value.glyphs))) if (validName(name)) { const glyph = normalizeGlyph(definition); if (glyph) glyphs[name] = glyph; }
  const fonts = {}; for (const [name, definition] of Object.entries(record(value.fonts))) if (validName(name) && definition && typeof definition === "object" && safeHttpsUrl(String(definition.url || ""))) fonts[name] = { type: "remote", url: String(definition.url) };
  const gradients = {}; for (const [name, definition] of Object.entries(record(value.gradients))) { const gradient = normalizeGradient(definition); if (validName(name) && gradient) gradients[name] = gradient; }
  const outlines = {}; for (const [name, definition] of Object.entries(record(value.outlines))) { const outline = normalizeOutline(definition); if (validName(name) && outline.length) outlines[name] = outline; }
  return { palettes: banks.default.slots, paletteNames: banks.default.names, banks, activeBank, styles, glyphs, fonts, gradients, outlines };
}

function colorReferenceValid(value) { return normalizeColorReference(value) !== null; }
function slotsFor(value) { return slotContainer(value); }

function validateBanks(value, errors) {
  const candidates = [];
  if (own(value, "palettes")) candidates.push(["default", value.palettes]);
  for (const key of ["paletteBanks", "banks"]) for (const [name, bank] of Object.entries(record(value[key]))) {
    if (!validName(name)) { errors.push(`Palette Bank名${name}が不正です。`); continue; }
    candidates.push([name, bank]);
  }
  const seen = new Set();
  for (const [name, bank] of candidates) {
    if (seen.has(name)) continue; seen.add(name);
    const slots = slotsFor(bank); if (Object.keys(slots).length > MAX_ENTRIES) errors.push(`Palette Bank ${name} のSlotが多すぎます。`);
    for (const [index, raw] of Object.entries(slots)) if (!/^\d+$/.test(index) || !slotValue(raw)) errors.push(`Palette ${name}:${index} が不正です。`);
    const names = record(record(bank).names); for (const [index, label] of Object.entries(names)) if (!/^\d+$/.test(index) || typeof label !== "string" || !label.trim() || label.length > 128) errors.push(`Palette ${name}:${index} の名前が不正です。`);
  }
  for (const [index, label] of Object.entries(record(value.paletteNames))) if (!/^\d+$/.test(index) || typeof label !== "string" || !label.trim() || label.length > 128) errors.push(`Palette default:${index} の名前が不正です。`);
}

function validateStyleDefinitions(value, errors, warnings) {
  const styles = record(value.styles);
  for (const [name, style] of Object.entries(styles)) {
    if (!validName(name) || !style || typeof style !== "object" || Array.isArray(style)) { errors.push(`Style ${name} が不正です。`); continue; }
    for (const key of Object.keys(style)) if (!STYLE_KEYS.has(key)) errors.push(`Style ${name} の${key}は未対応です。`);
    if (style.color !== undefined && !colorReferenceValid(style.color)) errors.push(`Style ${name} のcolor参照が不正です。`);
    if (style.bank !== undefined && !validName(String(style.bank))) errors.push(`Style ${name} のBank参照が不正です。`);
    if (style.extends !== undefined && !(Array.isArray(style.extends) ? style.extends.every(validName) : validName(style.extends))) errors.push(`Style ${name} の継承指定が不正です。`);
    if (style.outline !== undefined && !validName(String(style.outline))) errors.push(`Style ${name} のOutline参照が不正です。`);
    if (style.gradient !== undefined && !validName(String(style.gradient))) errors.push(`Style ${name} のGradient参照が不正です。`);
    if (style.font !== undefined && !validName(String(style.font))) errors.push(`Style ${name} のFont参照が不正です。`);
    if (style.weight !== undefined && !WEIGHT.test(String(style.weight))) errors.push(`Style ${name} のWeight指定が不正です。`);
    if (style.combine !== undefined && !normalizeCombine(style.combine)) errors.push(`Style ${name} のCombine指定が不正です。`);
    if (style.color !== undefined && normalizeColorReference(style.color)?.index > 1) warnings.push(`Style ${name} のPalette Slotは欠損時にSlot 1へFallbackします。`);
  }
  const visiting = new Set();
  const visit = (name, depth = 0) => {
    if (visiting.has(name)) { errors.push(`Style継承が循環しています: ${name}`); return; }
    visiting.add(name);
    if (depth > MAX_STYLE_DEPTH) errors.push(`Style ${name} の継承が深すぎます。`);
    const parents = record(styles[name]).extends; for (const parent of (Array.isArray(parents) ? parents : parents ? [parents] : [])) { if (!own(styles, parent)) errors.push(`Style ${name} の継承先${parent}が存在しません。`); else if (depth <= MAX_STYLE_DEPTH) visit(parent, depth + 1); }
    visiting.delete(name);
  };
  for (const name of Object.keys(styles)) visit(name);
}

function validateGlyphs(value, errors) {
  const glyphs = record(value.glyphs); if (Object.keys(glyphs).length > MAX_ASSET_COUNT) errors.push("Glyph定義が多すぎます。");
  let bytes = 0;
  for (const [name, glyph] of Object.entries(glyphs)) {
    if (!validName(name) || (typeof glyph !== "string" && (!glyph || typeof glyph !== "object" || Array.isArray(glyph)))) { errors.push(`Glyph ${name} が不正です。`); continue; }
    if (typeof glyph === "string") { if (glyph.length > MAX_GLYPH_TEXT_LENGTH) errors.push(`Glyph ${name} のfallback文字列が不正です。`); bytes += glyph.length; continue; }
    const type = glyph.type || (glyph.text !== undefined ? "text" : "");
    if (type === "text") { if (typeof glyph.text !== "string" || glyph.text.length > MAX_GLYPH_TEXT_LENGTH) errors.push(`Glyph ${name} のfallback文字列が不正です。`); }
    else if (["svg", "image"].includes(type)) { if (!safeAssetUrl(glyph.src || glyph.url)) errors.push(`Glyph ${name} のAsset URLが不正です。`); }
    else if (type === "font") { if (!validName(String(glyph.font || glyph.fontId || "")) || !String(glyph.glyph || glyph.codepoint || "")) errors.push(`Glyph ${name} のFont参照が不正です。`); }
    else errors.push(`Glyph ${name} のtypeが不正です。`);
    try { bytes += JSON.stringify(glyph).length; } catch { errors.push(`Glyph ${name} が読み取れません。`); }
  }
  if (bytes > MAX_ASSET_BYTES) errors.push("Glyph Assetの合計サイズが大きすぎます。");
}

function validateDefinitions(value, errors) {
  for (const [kind, definitions] of Object.entries({ fonts: value.fonts, gradients: value.gradients, outlines: value.outlines })) {
    if (definitions !== undefined && Object.keys(record(definitions)).length > MAX_ENTRIES) errors.push(`${kind}定義が多すぎます。`);
    for (const name of Object.keys(record(definitions))) if (!validName(name)) errors.push(`${kind}名${name}が不正です。`);
  }
  for (const [name, font] of Object.entries(record(value.fonts))) if (!font || typeof font !== "object" || Array.isArray(font) || font.type !== "remote" || !safeHttpsUrl(font.url)) errors.push(`Font ${name} が不正です。`);
  for (const [name, gradient] of Object.entries(record(value.gradients))) {
    if (!gradient || typeof gradient !== "object" || Array.isArray(gradient) || !DIRECTIONS.has(gradient.direction) || !Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 32) { errors.push(`Gradient ${name} が不正です。`); continue; }
    for (const stop of gradient.stops) {
      const hasPalette = colorReferenceValid(stop?.palette); const hasColor = HEX.test(String(stop?.color || ""));
      if (!stop || typeof stop !== "object" || !Number.isFinite(Number(stop.at)) || Number(stop.at) < 0 || Number(stop.at) > 1 || hasPalette === hasColor) errors.push(`Gradient ${name} のstopが不正です。`);
    }
  }
  for (const [name, outline] of Object.entries(record(value.outlines))) {
    const layers = Array.isArray(outline) ? outline : Array.isArray(outline?.layers) ? outline.layers : [outline];
    if (!layers.length || layers.length > 16) { errors.push(`Outline ${name} が不正です。`); continue; }
    for (const layer of layers) {
      const hasPalette = colorReferenceValid(layer?.color); const hasHex = HEX.test(String(layer?.color || ""));
      if (!layer || typeof layer !== "object" || !Number.isFinite(Number(layer.width)) || Number(layer.width) < 0 || Number(layer.width) > 8 || hasPalette === hasHex) errors.push(`Outline ${name} が不正です。`);
    }
  }
}

export function validateRegistry(registry = {}) {
  const errors = []; const warnings = []; const value = record(registry);
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) errors.push("RegistryはObject形式で指定してください。");
  try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_REGISTRY_BYTES) errors.push("Registryが大きすぎます。"); } catch { errors.push("Registryの形式が不正です。"); }
  for (const key of Object.keys(value)) if (!TOP_LEVEL.has(key)) errors.push(`Registryの項目${key}は未対応です。`);
  validateBanks(value, errors); validateStyleDefinitions(value, errors, warnings); validateGlyphs(value, errors); validateDefinitions(value, errors);
  const banks = sourceBanks(value); const styleDefinitions = record(value.styles);
  for (const [name, style] of Object.entries(styleDefinitions)) {
    if (!style || typeof style !== "object") continue;
    const color = normalizeColorReference(style.color); if (color?.bank && !banks[color.bank]) errors.push(`Style ${name} のPalette Bank参照が存在しません。`);
    if (style.bank !== undefined && !banks[String(style.bank)]) errors.push(`Style ${name} のPalette Bank参照が存在しません。`);
    if (style.outline !== undefined && !own(record(value.outlines), style.outline)) errors.push(`Style ${name} のOutline参照が存在しません。`);
    if (style.gradient !== undefined && !own(record(value.gradients), style.gradient)) errors.push(`Style ${name} のGradient参照が存在しません。`);
    if (style.font !== undefined && !own(record(value.fonts), style.font)) errors.push(`Style ${name} のFont参照が存在しません。`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function paletteValue(registry, index, bankName) {
  const normalized = registry?.banks ? registry : normalizeRegistry(registry);
  const bank = normalized.banks[bankName] || normalized.banks[normalized.activeBank] || normalized.banks.default;
  return bank?.slots?.[String(index)] || bank?.slots?.["1"] || "#000000";
}

function resolvedStyle(name, registry, stack = [], cache = new Map()) {
  if (cache.has(name)) return cache.get(name);
  if (stack.includes(name)) return { definition: {}, conflicts: [{ property: "extends", styles: [...stack, name] }], cycle: true };
  const style = registry.styles[name]; if (!style) return { definition: {}, conflicts: [] };
  const definition = {}; const conflicts = [];
  for (const parent of style.extends || []) {
    if (stack.length > MAX_STYLE_DEPTH) return { definition: {}, conflicts: [{ property: "extends", styles: [...stack, name] }], depth: true };
    const result = resolvedStyle(parent, registry, [...stack, name], cache);
    for (const [key, value] of Object.entries(result.definition)) {
      if (definition[key] !== undefined && !equal(definition[key], value)) conflicts.push({ property: key, styles: [parent], values: [definition[key], value] });
      else if (definition[key] === undefined) definition[key] = clone(value);
    }
    conflicts.push(...result.conflicts);
  }
  for (const [key, value] of Object.entries(style)) if (key !== "extends") definition[key] = clone(value);
  const result = { definition, conflicts }; cache.set(name, result); return result;
}

function presentationStyleNames(presentation) {
  const values = Array.isArray(presentation?.styles) ? presentation.styles : presentation?.style?.name ? [presentation.style] : [];
  return values.map(style => style?.name).filter(validName).filter((name, index, names) => names.indexOf(name) === index);
}

function resolvedOutline(name, registry, bankName) {
  return (registry.outlines[name] || []).map(layer => ({ width: Number(layer.width), color: resolveColor(layer.color, registry, bankName) })).filter(layer => layer.color);
}
function resolveColor(reference, registry, defaultBank) {
  if (typeof reference === "string" && HEX.test(reference)) return reference;
  const color = normalizeColorReference(reference); if (!color) return paletteValue(registry, 1, defaultBank);
  return paletteValue(registry, color.index, color.bank || defaultBank);
}

function paletteSlotExists(registry, index, bankName) {
  const bank = registry.banks[bankName] || registry.banks[registry.activeBank] || registry.banks.default;
  return own(bank?.slots || {}, String(index));
}

export function resolvePresentation(presentation = {}, registry = {}) {
  const normalized = normalizeRegistry(registry); const styles = presentationStyleNames(presentation); const cache = new Map(); const merged = {}; const conflicts = []; const warnings = [];
  for (const name of styles) {
    if (!normalized.styles[name]) { warnings.push(`Style ${name} が存在しません。`); continue; }
    const result = resolvedStyle(name, normalized, [], cache); for (const conflict of result.conflicts) conflicts.push({ ...conflict, styles: conflict.styles?.length ? conflict.styles : [name] });
    for (const [key, value] of Object.entries(result.definition)) {
      if (merged[key] !== undefined && !equal(merged[key], value)) conflicts.push({ property: key, styles: [name], values: [merged[key], value] });
      else if (merged[key] === undefined) merged[key] = clone(value);
    }
  }
  const direct = presentation || {}; const bankName = direct.bank?.name || (validName(direct.bank) ? direct.bank : merged.bank) || normalized.activeBank;
  if (direct.bank?.name && !normalized.banks[direct.bank.name]) warnings.push(`Palette Bank ${direct.bank.name} が存在しません。`);
  const colorReference = direct.color || merged.color || 0; const normalizedColor = normalizeColorReference(colorReference); const color = resolveColor(colorReference, normalized, bankName);
  if (normalizedColor && !paletteSlotExists(normalized, normalizedColor.index, normalizedColor.bank || bankName)) warnings.push(`Palette ${normalizedColor.bank || bankName}:${normalizedColor.index} が存在しないためSlot 1へFallbackします。`);
  const glyphName = direct.glyph?.name; const glyph = glyphName ? normalized.glyphs[glyphName] : null;
  if (glyphName && !glyph) warnings.push(`Glyph ${glyphName} が存在しません。Source文字へFallbackします。`);
  const combine = direct.combine || merged.combine; const normalizedCombine = combine ? normalizeCombine(combine) : null;
  const outlineName = direct.outline?.name || merged.outline; const gradientName = direct.gradient?.name || merged.gradient; const fontName = direct.font?.name || merged.font;
  const conflictColors = conflicts.filter(conflict => conflict.property === "color").flatMap(conflict => conflict.values || []).map(value => resolveColor(value, normalized, bankName)).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
  const resolved = { color, paletteBank: bankName, glyph: glyph ? clone(glyph) : null, glyphAsset: glyph ? clone(glyph) : null, glyphText: glyph?.type === "text" ? glyph.text : null, combine: normalizedCombine, styleNames: styles, styleName: styles[0] || null, styleDefinitions: styles.filter(name => normalized.styles[name]).map(name => ({ name, definition: clone(normalized.styles[name]) })), conflicts, conflictColors, warnings };
  if (outlineName && normalized.outlines[outlineName]) { resolved.outlines = resolvedOutline(outlineName, normalized, bankName); resolved.outline = resolved.outlines[0] || null; }
  else if (outlineName) warnings.push(`Outline ${outlineName} が存在しません。`);
  if (gradientName && normalized.gradients[gradientName]) {
    const gradient = normalized.gradients[gradientName]; resolved.gradient = { direction: gradient.direction, fallbackColor: paletteValue(normalized, 0, bankName), stops: gradient.stops.map(stop => ({ position: Number(stop.at), color: stop.color || resolveColor(stop.palette, normalized, bankName) })).filter(stop => stop.color) };
  } else if (gradientName) warnings.push(`Gradient ${gradientName} が存在しません。`);
  const glyphFontName = glyph?.type === "font" ? glyph.font : null; const resolvedFontName = fontName || glyphFontName;
  if (resolvedFontName && normalized.fonts[resolvedFontName]) { resolved.fontDefinition = clone(normalized.fonts[resolvedFontName]); resolved.font = { type: "remote", url: normalized.fonts[resolvedFontName].url, family: `ReaderFont-${resolvedFontName}` }; }
  else if (resolvedFontName) warnings.push(`Font ${resolvedFontName} が存在しません。`);
  if (direct.weight || merged.weight) resolved.weight = String(direct.weight?.value || direct.weight || merged.weight);
  return resolved;
}

function renamePresentation(presentation, from, to) {
  if (!presentation || typeof presentation !== "object") return;
  for (const key of ["style", "styles"]) {
    if (Array.isArray(presentation[key])) {
      for (const style of presentation[key]) if (style?.name === from) style.name = to;
    } else if (presentation[key]?.name === from) presentation[key].name = to;
  }
  for (const key of ["base", "ruby"]) renamePresentation(presentation[key], from, to);
}
function renameNodes(nodes, from, to) {
  for (const node of nodes || []) {
    if (node.type === "span") { renamePresentation(node.presentation, from, to); renameNodes(node.children, from, to); }
    if (node.type === "ruby") for (const decoration of [...(node.baseDecorations || []), ...(node.rubyDecorations || [])]) renamePresentation(decoration.presentation, from, to);
  }
}
function renamePresentationMap(value, from, to) {
  for (const presentation of Object.values(record(value))) renamePresentation(presentation, from, to);
}

/** Rename a Named Style as one atomic document transaction, including Source references. */
function renameLinks(links, from, to) {
  for (const link of Array.isArray(links) ? links : []) {
    renamePresentation(link?.presentation, from, to);
    for (const member of Array.isArray(link?.members) ? link.members : []) renamePresentation(member?.presentation, from, to);
  }
}

export function renameStyleInDocument(document, from, to) {
  if (!validName(from) || !validName(to) || from === to) throw new Error("Style名の変更指定が不正です。");
  const result = clone(document);
  const holder = result.registry ? result : result.manifest?.registry ? result.manifest : null;
  const registry = holder?.registry || {};
  if (!own(record(registry.styles), from)) throw new Error(`Style ${from} が存在しません。`);
  if (own(record(registry.styles), to)) throw new Error(`Style ${to} は既に存在します。`);
  const styles = clone(record(registry.styles));
  styles[to] = styles[from];
  delete styles[from];
  for (const style of Object.values(styles)) {
    if (style?.extends === from) style.extends = to;
    else if (Array.isArray(style?.extends)) style.extends = style.extends.map(parent => parent === from ? to : parent);
  }
  if (holder) holder.registry = { ...registry, styles };
  else result.registry = { ...registry, styles };
  const format = result.content?.format || result.format || "narou-text";
  const adapter = getSyntaxAdapter(format);
  for (const variant of result.content?.variants || result.variants || []) {
    if (typeof variant?.source?.text === "string" && variant.source.text.includes(`style=${from}`)) {
      const parsed = adapter.parse(variant.source.text);
      renameNodes(parsed.nodes, from, to);
      variant.source.text = adapter.serialize(parsed);
    }
    renamePresentation(variant?.presentation, from, to);
    renamePresentationMap(variant?.overrides, from, to);
  }
  renameNodes(result.nodes, from, to);
  renameLinks(result.links, from, to);
  renameLinks(result.content?.links, from, to);
  for (const overrides of Object.values(record(result.variantOverrides))) renamePresentationMap(overrides, from, to);
  for (const overrides of Object.values(record(result.content?.variantOverrides))) renamePresentationMap(overrides, from, to);
  return result;
}
