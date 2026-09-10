// @ts-check
import { parseRuby } from "./ruby-parser.js";
import { MAX_SOURCE_BYTES } from "./config.js";
import { normalizeRubyRange } from "./runtime-integrity.js";

/** @typedef {{type: "text", value: string}} TextNode */
/** @typedef {{type: "ruby", base: string, ruby: string, explicit: boolean, baseDecorations?: RubyDecoration[], rubyDecorations?: RubyDecoration[]}} RubyNode */
/** @typedef {{type: "span", children: ReaderNode[], presentation: Presentation}} SpanNode */
/** @typedef {TextNode|RubyNode|SpanNode} ReaderNode */
/** @typedef {{start: number, end: number, presentation: Presentation}} RubyDecoration */
/** @typedef {{color?: {type: "palette", index: number}, bank?: {type: "palette-bank", name: string}, style?: {type: "style", name: string}, styles?: Array<{type: "style", name: string}>, glyph?: {type: "glyph", name: string}, combine?: {type: "combine", mode: "straight"|"parallel"|"z"}, font?: {type: "font", name: string}, weight?: {type: "weight", value: string}, outline?: {type: "outline", name: string}, gradient?: {type: "gradient", name: string}, base?: Presentation, ruby?: Presentation, baseRange?: {start: number, end: number}, rubyRange?: {start: number, end: number}}} Presentation */
/** @typedef {{type: "document", nodes: ReaderNode[]}} ReaderDocument */

export const PARSER_LIMITS = Object.freeze({ maxDepth: 32, maxNodes: 100_000, maxAttributes: 16, maxSourceLength: 500_000 });
const GRAPHEME_SEGMENTER = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Count user-visible grapheme clusters, never UTF-16 code units. */
export function graphemes(value) {
  const text = String(value ?? "");
  if (GRAPHEME_SEGMENTER) return [...GRAPHEME_SEGMENTER.segment(text)].map(item => item.segment);
  return Array.from(text);
}

/** Syntax-independent boundary between Author Source and Reader Core. */
export const narouTextAdapter = Object.freeze({
  id: "narou-text",
  capabilities: Object.freeze({ ruby: true, presentationMarkup: true, provisionalSyntax: true, escapedLiterals: true, nestedPresentation: true, multilinePresentation: true, multiplePresentation: true, graphemeBoundaries: true }),
  parse(source) { const value = String(source); assertSourceSize(value); return { type: "document", nodes: parseProvisional(value) }; },
  serialize(document) { return serializeAuthor(normalizeNodes(document?.nodes || [])); },
  toPortableText(document) { return serializePortable(document?.nodes || []); },
  toPlainText(document) { return plainText(document?.nodes || []); },
  validate(source) { return validateWith(this, source); }
});

/** Boundary adapter for documents written with the pre-vNext [text]{attrs} syntax. */
export const legacyNarouTextAdapter = Object.freeze({
  id: "narou-legacy",
  capabilities: Object.freeze({ ruby: true, presentationMarkup: true, provisionalSyntax: true, escapedLiterals: true, nestedPresentation: true, multilinePresentation: true, multiplePresentation: true, graphemeBoundaries: true }),
  parse(source) { const value = String(source); assertSourceSize(value); return { type: "document", nodes: parseLegacy(value) }; },
  serialize(document) { return serializeLegacy(normalizeNodes(document?.nodes || [])); },
  toPortableText(document) { return serializePortable(document?.nodes || []); },
  toPlainText(document) { return plainText(document?.nodes || []); },
  validate(source) { return validateWith(this, source); }
});

const syntaxAdapters = Object.freeze({ narou: legacyNarouTextAdapter, "narou-legacy": legacyNarouTextAdapter, "narou-text": narouTextAdapter });
export function getSyntaxAdapter(format = "narou-text") {
  const adapter = syntaxAdapters[String(format || "narou-text")];
  if (!adapter) throw new Error(`未対応の本文formatです: ${format}`);
  return adapter;
}

function presentationNodeCount(nodes = []) {
  return nodes.reduce((count, node) => count + (node?.type === "span" ? 1 + presentationNodeCount(node.children) : 0), 0);
}

/** Detect a legacy surface syntax without changing the canonical default. */
export function detectSyntaxAdapter(source, fallback = "narou-text") {
  const preferred = getSyntaxAdapter(fallback);
  if (preferred !== narouTextAdapter) return preferred;
  const value = String(source ?? "");
  let current = null;
  let legacy = null;
  try { current = narouTextAdapter.parse(value); } catch { /* the loader reports the canonical parse error later */ }
  try { legacy = legacyNarouTextAdapter.parse(value); } catch { /* malformed input keeps the canonical adapter */ }
  if (legacy && presentationNodeCount(legacy.nodes) > (current ? presentationNodeCount(current.nodes) : 0)) return legacyNarouTextAdapter;
  return preferred;
}

export function assertCapabilities(adapter, required = {}) {
  for (const [capability, enabled] of Object.entries(required)) if (enabled && !adapter?.capabilities?.[capability]) throw new Error(`Syntax Adapterが${capability}に対応していません。`);
  return adapter;
}

function validateWith(adapter, source) {
  if (typeof source !== "string") return { valid: false, errors: ["Sourceは文字列である必要があります。"] };
  try { adapter.parse(source); return { valid: true, errors: [] }; }
  catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : "Sourceを解析できませんでした。"] }; }
}

function assertSourceSize(source) {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) throw new Error("本文が大きすぎます。");
}

function withSourceIndex(error, index) {
  const result = error instanceof Error ? error : new Error(String(error));
  if (!Number.isInteger(result.sourceIndex)) result.sourceIndex = Math.max(0, Number(index) || 0);
  return result;
}

const PRESENTATION_KEYS = new Set(["c", "bank", "style", "glyph", "combine", "font", "weight", "outline", "gradient"]);
const SAFE_NAME = /^[\w-]+$/;
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);
export function isSafePresentationName(value) { return typeof value === "string" && SAFE_NAME.test(value) && !RESERVED_NAMES.has(value); }
const safeName = value => isSafePresentationName(value);

function splitUnescaped(source, separator) {
  const result = []; let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === separator) { result.push(source.slice(start, index)); start = index + 1; }
  }
  result.push(source.slice(start));
  return result;
}

function parsePresentation(source) {
  const presentation = {}; const styles = []; const scopedStyles = { base: [], ruby: [] };
  const parts = splitUnescaped(String(source), ",").map(value => decodeEscapes(value.trim())).filter(Boolean);
  if (!parts.length) throw new Error("Presentation指定が空です。");
  if (parts.length > PARSER_LIMITS.maxAttributes) throw new Error("Presentation属性が多すぎます。");
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = (separator < 0 ? part : part.slice(0, separator)).trim();
    const value = separator < 0 ? "" : part.slice(separator + 1).trim();
    const scopeMatch = /^(base|ruby)-(.+)$/.exec(key);
    if (scopeMatch) {
      const scope = scopeMatch[1]; const scoped = presentation[scope] || (presentation[scope] = {}); const scopedKey = scopeMatch[2];
      if (scopedKey === "range") {
        if (scoped.range || !/^\d+-\d+$/.test(value)) throw new Error(`不正な${scope === "base" ? "親文字" : "ルビ"}範囲指定です: ${part}`);
        const [start, end] = value.split("-").map(Number);
        if (end <= start) throw new Error(`不正な${scope === "base" ? "親文字" : "ルビ"}範囲指定です: ${part}`);
        scoped.range = { start, end };
      } else if (!setPresentationProperty(scoped, scopedKey, value, part, scopedStyles[scope])) return null;
    } else if (!setPresentationProperty(presentation, key, value, part, styles)) return null;
  }
  finalizeStyles(presentation, styles);
  finalizeStyles(presentation.base, scopedStyles.base);
  finalizeStyles(presentation.ruby, scopedStyles.ruby);
  if (!hasEffectivePresentation(presentation)) throw new Error("Presentation指定に有効な属性がありません。");
  return presentation;
}

function hasEffectivePresentation(value) {
  return Object.entries(value || {}).some(([key, candidate]) => {
    if (key === "range") return false;
    if (key === "base" || key === "ruby") return hasEffectivePresentation(candidate);
    return candidate !== undefined && candidate !== null;
  });
}

function setPresentationProperty(target, key, value, part, styles) {
  if (!PRESENTATION_KEYS.has(key)) return false;
  if (key === "c") {
    if (target.color || !/^\d+$/.test(value)) throw new Error(`不正なPalette指定です: ${part}`);
    target.color = { type: "palette", index: Number(value) };
  } else if (key === "bank") {
    if (target.bank || !safeName(value)) throw new Error(`不正なPalette Bank指定です: ${part}`);
    target.bank = { type: "palette-bank", name: value };
  } else if (key === "style") {
    if (!safeName(value)) throw new Error(`不正なStyle指定です: ${part}`);
    styles.push({ type: "style", name: value });
  } else if (key === "glyph") {
    if (target.glyph || !safeName(value)) throw new Error(`不正なGlyph指定です: ${part}`);
    target.glyph = { type: "glyph", name: value };
  } else if (key === "combine") {
    if (target.combine || (value && !["straight", "parallel", "z"].includes(value))) throw new Error(`不正なCombine指定です: ${part}`);
    target.combine = { type: "combine", mode: value || "straight" };
  } else if (key === "font") {
    if (target.font || !safeName(value)) throw new Error(`不正なFont指定です: ${part}`);
    target.font = { type: "font", name: value };
  } else if (key === "weight") {
    if (target.weight || !/^(?:normal|bold|bolder|lighter|[1-9]\d{2})$/i.test(value)) throw new Error(`不正なWeight指定です: ${part}`);
    target.weight = { type: "weight", value };
  } else if (key === "outline") {
    if (target.outline || !safeName(value)) throw new Error(`不正なOutline指定です: ${part}`);
    target.outline = { type: "outline", name: value };
  } else if (key === "gradient") {
    if (target.gradient || !safeName(value)) throw new Error(`不正なGradient指定です: ${part}`);
    target.gradient = { type: "gradient", name: value };
  }
  return true;
}

function finalizeStyles(target, styles) {
  if (!target || !styles.length) return;
  const unique = styles.filter((style, index) => styles.findIndex(candidate => candidate.name === style.name) === index);
  if (unique.length === 1) target.style = unique[0];
  else target.styles = unique;
}

function decodeEscapes(value) { return String(value).replace(/\\([\\\[\]:{}｜《》])/g, "$1"); }
function escapeLiteral(value, inPresentationTarget = false) {
  const pattern = inPresentationTarget ? /[\\\[\]:{}｜《》]/g : /[\\\[\]｜《》]/g;
  return String(value).replace(pattern, match => `\\${match}`);
}
function protectRubyEscapes(value) { return String(value).replace(/\\｜/g, "\uE000").replace(/\\《/g, "\uE001").replace(/\\》/g, "\uE002"); }
function restoreRubyEscapes(nodes) {
  return nodes.map(node => {
    if (node.type === "span") return { ...node, children: restoreRubyEscapes(node.children || []) };
    if (node.type === "ruby") return { ...node, base: decodeEscapes(node.base), ruby: decodeEscapes(node.ruby) };
    return { ...node, value: decodeEscapes(node.value.replace(/\uE000/g, "｜").replace(/\uE001/g, "《").replace(/\uE002/g, "》")) };
  });
}

function appendNodes(target, nodes, stats) {
  for (const node of nodes) {
    stats.nodes++;
    if (stats.nodes > PARSER_LIMITS.maxNodes) throw new Error("Sourceの要素数が多すぎます。");
    target.push(node);
  }
}

/** Build bracket pairs once per recursive range to keep malformed input linear. */
function bracketPairs(source) {
  const stack = []; const pairs = new Map();
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === "[") stack.push(index);
    else if (source[index] === "]" && stack.length) pairs.set(stack.pop(), index);
  }
  return pairs;
}

function topLevelColon(source, start, close) {
  let depth = 0;
  for (let index = start; index < close; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === "[") depth++;
    else if (source[index] === "]") depth--;
    else if (source[index] === ":" && depth === 0) return index;
  }
  return -1;
}

function plainNodes(source, stats) {
  const nodes = restoreRubyEscapes(parseRuby(protectRubyEscapes(source)));
  return nodes;
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}

function parseProvisional(source, depth = 0, stats = { nodes: 0 }, sourceOffset = 0) {
  if (source.length > PARSER_LIMITS.maxSourceLength) throw withSourceIndex(new Error("Sourceが大きすぎます。"), sourceOffset);
  if (depth > PARSER_LIMITS.maxDepth) throw withSourceIndex(new Error("Presentationの入れ子が深すぎます。"), sourceOffset);
  const nodes = []; const pairs = bracketPairs(source); let cursor = 0; let plainStart = 0;
  const flushPlain = end => { if (end > plainStart) appendNodes(nodes, plainNodes(source.slice(plainStart, end), stats), stats); };
  while (cursor < source.length) {
    if (source[cursor] !== "[" || isEscaped(source, cursor)) { cursor++; continue; }
    const close = pairs.get(cursor); if (close === undefined) { cursor++; continue; }
    const colon = topLevelColon(source, cursor + 1, close);
    if (colon < 0) { cursor++; continue; }
    let presentation;
    try { presentation = parsePresentation(source.slice(colon + 1, close)); }
    catch (error) { throw withSourceIndex(error, sourceOffset + colon + 1); }
    if (!presentation) { cursor = close + 1; continue; }
    flushPlain(cursor);
    let children;
    try {
      children = parseProvisional(source.slice(cursor + 1, colon), depth + 1, stats, sourceOffset + cursor + 1);
      if ((presentation.base || presentation.ruby) && (children.length !== 1 || children[0].type !== "ruby")) throw new Error("親文字・ルビ範囲指定の対象はRubyである必要があります。");
    } catch (error) { throw withSourceIndex(error, sourceOffset + cursor); }
    let rubyDecorated;
    try { rubyDecorated = decorateRubyChildren(children, presentation); }
    catch (error) { throw withSourceIndex(error, sourceOffset + cursor); }
    appendNodes(nodes, [rubyDecorated || { type: "span", children, presentation }], stats);
    cursor = close + 1; plainStart = cursor;
  }
  flushPlain(source.length);
  return normalizeNodes(nodes);
}

function decorateRubyChildren(children, presentation) {
  if (children.length !== 1 || children[0].type !== "ruby" || (!presentation.base && !presentation.ruby)) return null;
  const ruby = { ...children[0] };
  const add = (part, length, key, label) => {
    const scoped = presentation[part]; const start = scoped.range?.start ?? 0; const end = scoped.range?.end ?? length;
    if (start < 0 || end > length || end <= start) throw new Error(`${label}範囲が本文の長さを超えています。`);
    ruby[key] = [...(ruby[key] || []), { start, end, presentation: omitRange(scoped) }];
  };
  if (presentation.base) add("base", graphemes(ruby.base).length, "baseDecorations", "親文字");
  if (presentation.ruby) add("ruby", graphemes(ruby.ruby).length, "rubyDecorations", "ルビ");
  const direct = { ...presentation }; delete direct.base; delete direct.ruby; delete direct.range;
  return hasEffectivePresentation(direct) ? { type: "span", children: [ruby], presentation: direct } : ruby;
}

function omitRange(presentation) {
  const { range: _range, ...rest } = presentation || {};
  return rest;
}

function parseLegacy(source, depth = 0, stats = { nodes: 0 }, sourceOffset = 0) {
  if (source.length > PARSER_LIMITS.maxSourceLength) throw withSourceIndex(new Error("Sourceが大きすぎます。"), sourceOffset);
  if (depth > PARSER_LIMITS.maxDepth) throw withSourceIndex(new Error("Presentationの入れ子が深すぎます。"), sourceOffset);
  const nodes = []; const pairs = bracketPairs(source); let cursor = 0; let plainStart = 0;
  const flushPlain = end => { if (end > plainStart) appendNodes(nodes, plainNodes(source.slice(plainStart, end), stats), stats); };
  while (cursor < source.length) {
    if (source[cursor] !== "[" || isEscaped(source, cursor)) { cursor++; continue; }
    const closeBracket = pairs.get(cursor); if (closeBracket === undefined || source[closeBracket + 1] !== "{") { cursor++; continue; }
    const closeAttribute = findLegacyBrace(source, closeBracket + 1);
    if (closeAttribute < 0) { cursor++; continue; }
    let presentation;
    try { presentation = parsePresentation(source.slice(closeBracket + 2, closeAttribute)); }
    catch (error) { throw withSourceIndex(error, sourceOffset + closeBracket + 2); }
    if (!presentation) { cursor = closeAttribute + 1; continue; }
    flushPlain(cursor);
    let children;
    try {
      children = parseLegacy(source.slice(cursor + 1, closeBracket), depth + 1, stats, sourceOffset + cursor + 1);
      if ((presentation.base || presentation.ruby) && (children.length !== 1 || children[0].type !== "ruby")) throw new Error("親文字・ルビ範囲指定の対象はRubyである必要があります。");
    } catch (error) { throw withSourceIndex(error, sourceOffset + cursor); }
    let rubyDecorated;
    try { rubyDecorated = decorateRubyChildren(children, presentation); }
    catch (error) { throw withSourceIndex(error, sourceOffset + cursor); }
    appendNodes(nodes, [rubyDecorated || { type: "span", children, presentation }], stats);
    cursor = closeAttribute + 1; plainStart = cursor;
  }
  flushPlain(source.length);
  return normalizeNodes(nodes);
}

function findLegacyBrace(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function serializePresentation(presentation = {}, prefix = "") {
  const attrs = [];
  const key = name => prefix ? `${prefix}-${name}` : name;
  if (presentation.color) attrs.push(`${key("c")}=${presentation.color.index}`);
  if (presentation.bank) attrs.push(`${key("bank")}=${presentation.bank.name}`);
  const styles = Array.isArray(presentation.styles) && presentation.styles.length ? presentation.styles : presentation.style ? [presentation.style] : [];
  for (const style of styles) attrs.push(`${key("style")}=${style.name}`);
  if (presentation.glyph) attrs.push(`${key("glyph")}=${presentation.glyph.name}`);
  if (presentation.font) attrs.push(`${key("font")}=${presentation.font.name}`);
  if (presentation.weight) attrs.push(`${key("weight")}=${presentation.weight.value}`);
  if (presentation.outline) attrs.push(`${key("outline")}=${presentation.outline.name}`);
  if (presentation.gradient) attrs.push(`${key("gradient")}=${presentation.gradient.name}`);
  if (presentation.combine) {
    const mode = typeof presentation.combine === "object" ? presentation.combine.mode || "straight" : "straight";
    attrs.push(mode === "straight" ? key("combine") : `${key("combine")}=${mode}`);
  }
  return attrs.join(",");
}

function serializeRubyCore(node, inPresentationTarget = false) {
  return `${node.explicit ? "｜" : ""}${escapeLiteral(node.base, inPresentationTarget)}《${escapeLiteral(node.ruby, inPresentationTarget)}》`;
}
function serializeRuby(node, inPresentationTarget = false) {
  let result = serializeRubyCore(node, inPresentationTarget);
  for (const decoration of [...(node.baseDecorations || []), ...(node.rubyDecorations || [])]) {
    const scope = node.baseDecorations?.includes(decoration) ? "base" : "ruby";
    const range = `${scope}-range=${decoration.start}-${decoration.end}`;
    result = `[${result}:${range},${serializePresentation(decoration.presentation, scope)}]`;
  }
  return result;
}
function serializeAuthor(nodes, inPresentationTarget = false) {
  return nodes.map(node => {
    if (node.type === "span") return `[${serializeAuthor(node.children || [], true)}:${serializePresentation(node.presentation)}]`;
    if (node.type === "ruby") return serializeRuby(node, inPresentationTarget);
    return escapeLiteral(node.value, inPresentationTarget);
  }).join("");
}
function serializeLegacy(nodes, inPresentationTarget = false) {
  return nodes.map(node => {
    if (node.type === "span") return `[${serializeLegacy(node.children || [], true)}]{${serializePresentation(node.presentation)}}`;
    if (node.type === "ruby") return serializeRuby(node, inPresentationTarget);
    return escapeLiteral(node.value, inPresentationTarget);
  }).join("");
}
function serializePortable(nodes) { return nodes.map(node => node.type === "span" ? serializePortable(node.children || []) : node.type === "ruby" ? serializeRubyCore(node) : node.value).join(""); }
function plainText(nodes) { return nodes.map(node => node.type === "span" ? plainText(node.children || []) : node.type === "ruby" ? node.base : node.value).join(""); }

export function parseSource(source, adapter = narouTextAdapter) { return adapter.parse(source); }
export function serializeSource(document, adapter = narouTextAdapter) { return adapter.serialize(document); }
export function toPortableText(document, adapter = narouTextAdapter) { return adapter.toPortableText(document); }
export function toPlainText(document, adapter = narouTextAdapter) { return adapter.toPlainText(document); }
export function validateSource(source, adapter = narouTextAdapter) { return adapter.validate(source); }
/** Project readable text without allowing malformed Presentation to block Copy. */
export function toPortableTextSafe(source, adapter = narouTextAdapter) {
  try { return toPortableText(parseSource(source, adapter), adapter); }
  catch { return String(source ?? ""); }
}
export function nodeLength(node) { return node.type === "span" ? (node.children || []).reduce((sum, child) => sum + nodeLength(child), 0) : graphemes(node.type === "ruby" ? node.base : node.value).length; }

function samePresentation(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
function normalizeRubyDecorations(value, length) {
  return (Array.isArray(value) ? value : []).filter(decoration => Number.isInteger(decoration?.start) && Number.isInteger(decoration?.end) && decoration.end > decoration.start && decoration.start >= 0 && decoration.end <= length && hasEffectivePresentation(decoration.presentation || {})).map(decoration => ({ start: decoration.start, end: decoration.end, presentation: structuredClone(decoration.presentation || {}) })).sort((a, b) => a.start - b.start || a.end - b.end);
}
export function normalizeNodes(nodes = []) {
  const result = [];
  for (const raw of nodes) {
    if (!raw) continue;
    let node;
    if (raw.type === "span") node = { ...raw, children: normalizeNodes(raw.children || []) };
    else if (raw.type === "ruby") {
      node = { ...raw };
      const baseDecorations = normalizeRubyDecorations(raw.baseDecorations, graphemes(raw.base).length);
      const rubyDecorations = normalizeRubyDecorations(raw.rubyDecorations, graphemes(raw.ruby).length);
      if (baseDecorations.length) node.baseDecorations = baseDecorations; else delete node.baseDecorations;
      if (rubyDecorations.length) node.rubyDecorations = rubyDecorations; else delete node.rubyDecorations;
    } else node = { ...raw };
    if (node.type === "span" && !node.children.length) continue;
    const previous = result.at(-1);
    if (node.type === "text" && previous?.type === "text") previous.value += node.value;
    else if (node.type === "span" && previous?.type === "span" && samePresentation(previous.presentation, node.presentation)) previous.children.push(...node.children);
    else result.push(node);
  }
  return result;
}

function styleList(presentation = {}) {
  const values = Array.isArray(presentation.styles) ? presentation.styles : presentation.style?.name ? [presentation.style] : [];
  return values.filter(style => style?.name).filter((style, index) => values.findIndex(candidate => candidate?.name === style.name) === index).map(style => structuredClone(style));
}
function mergePresentation(base = {}, next = {}, appendStyles = false) {
  const result = { ...structuredClone(base || {}), ...structuredClone(next || {}) };
  if (appendStyles) {
    const styles = [...styleList(base), ...styleList(next)];
    if (styles.length === 1) { result.style = styles[0]; delete result.styles; }
    else if (styles.length > 1) { result.styles = styles; delete result.style; }
  }
  return result;
}
function wrap(nodes, presentation) { return nodes.length ? [{ type: "span", children: nodes, presentation: structuredClone(presentation || {}) }] : []; }
function overlay(nodes, presentation) { return nodes.map(node => node.type === "span" ? { ...node, presentation: mergePresentation(node.presentation, presentation, true) } : node); }
function inherit(nodes, presentation) { return nodes.map(node => node.type === "span" ? { ...node, presentation: { ...(structuredClone(presentation || {})), ...(node.presentation || {}) } } : node); }

/** Partition one node into before/selected/after using grapheme offsets. Ruby is one semantic unit. */
function partitionNode(node, start, end) {
  const length = nodeLength(node);
  if (end <= 0) return { before: [], selected: [], after: [node] };
  if (start >= length) return { before: [node], selected: [], after: [] };
  if (node.type === "ruby") return { before: [], selected: [node], after: [] };
  if (node.type === "span" && start <= 0 && end >= length) return { before: [], selected: [node], after: [] };
  if (node.type === "text") {
    const chars = graphemes(node.value); const from = Math.max(0, start); const to = Math.min(length, end);
    return { before: from ? [{ type: "text", value: chars.slice(0, from).join("") }] : [], selected: to > from ? [{ type: "text", value: chars.slice(from, to).join("") }] : [], after: to < length ? [{ type: "text", value: chars.slice(to).join("") }] : [] };
  }
  const before = []; const selected = []; const after = []; let offset = 0;
  for (const child of node.children || []) {
    const part = partitionNode(child, start - offset, end - offset);
    before.push(...part.before); selected.push(...part.selected); after.push(...part.after); offset += nodeLength(child);
  }
  const selectedWithPresentation = selected.flatMap(child => child.type === "span" ? inherit([child], node.presentation) : wrap([child], node.presentation));
  return { before: wrap(before, node.presentation), selected: selectedWithPresentation, after: wrap(after, node.presentation) };
}

function partitionDocument(document, range) {
  const start = Math.max(0, Number(range?.start) || 0); const end = Math.max(start, Number(range?.end) || 0);
  const before = []; const selected = []; const after = []; let offset = 0;
  for (const node of document?.nodes || []) { const part = partitionNode(node, start - offset, end - offset); before.push(...part.before); selected.push(...part.selected); after.push(...part.after); offset += nodeLength(node); }
  return { before, selected, after, start, end };
}

function insertTextAt(nodes, position, value) {
  const result = []; let offset = 0; let inserted = false;
  const insert = () => { if (!inserted && value) { result.push({ type: "text", value }); inserted = true; } };
  for (const node of nodes || []) {
    const length = nodeLength(node);
    if (!inserted && position <= offset) insert();
    if (!inserted && node.type === "span" && position < offset + length) {
      result.push({ ...node, children: insertTextAt(node.children || [], position - offset, value) });
      inserted = true;
    } else if (!inserted && node.type === "text" && position > offset && position < offset + length) {
      const chars = graphemes(node.value); const local = position - offset;
      result.push({ type: "text", value: chars.slice(0, local).join("") }); insert(); result.push({ type: "text", value: chars.slice(local).join("") });
    } else if (!inserted && node.type === "ruby" && position > offset && position < offset + length) {
      const chars = graphemes(node.base); const local = position - offset;
      result.push({ ...node, base: `${chars.slice(0, local).join("")}${value}${chars.slice(local).join("")}` }); inserted = true;
    } else result.push(node);
    offset += length;
  }
  insert(); return normalizeNodes(result);
}

/** Replace a semantic display range while retaining surrounding Presentation IR. */
export function replaceText(document, range, value) {
  const start = Math.max(0, Number(range?.start) || 0); const end = Math.max(start, Number(range?.end) || start); const text = String(value ?? "");
  if (start === end) return { ...document, nodes: insertTextAt(document?.nodes || [], start, text) };
  const parts = partitionDocument(document, { start, end });
  const replacement = text ? [{ type: "text", value: text }] : [];
  return { ...document, nodes: normalizeNodes([...parts.before, ...replacement, ...parts.after]) };
}

function stripPresentation(nodes) { return nodes.flatMap(node => { if (node.type === "span") return stripPresentation(node.children || []); if (node.type !== "ruby") return [node]; const plain = { ...node }; delete plain.baseDecorations; delete plain.rubyDecorations; return [plain]; }); }

function clonePresentation(presentation) { return structuredClone(presentation || {}); }
function addRubyDecoration(node, part, start, end, presentation) {
  const key = part === "base" ? "baseDecorations" : "rubyDecorations";
  const decorations = (node[key] || []).map(decoration => ({ ...decoration, presentation: clonePresentation(decoration.presentation) }));
  const sameRange = decorations.find(decoration => decoration.start === start && decoration.end === end);
  if (sameRange) sameRange.presentation = mergePresentation(sameRange.presentation, presentation, true);
  else decorations.push({ start, end, presentation: clonePresentation(presentation) });
  return { ...node, [key]: decorations };
}

function applyRubyAtPath(nodes, path, part, start, end, presentation, depth = 0) {
  const [index, ...rest] = path;
  return nodes.map((node, nodeIndex) => {
    if (nodeIndex !== index) return node;
    if (!rest.length && node.type === "ruby") return addRubyDecoration(node, part, start, end, presentation);
    if (node.type !== "span") return node;
    return { ...node, children: applyRubyAtPath(node.children || [], rest, part, start, end, presentation, depth + 1) };
  });
}

function findPartialRuby(nodes, start, end, offset = 0, path = []) {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]; const nextPath = [...path, index];
    if (node.type === "span") {
      const found = findPartialRuby(node.children || [], start, end, offset, nextPath);
      if (found) return found;
      offset += nodeLength(node);
    } else if (node.type === "ruby") {
      const length = graphemes(node.base).length;
      if (start >= offset && end <= offset + length && end > start && end - start < length) return { path: nextPath, start: start - offset, end: end - offset, part: "base" };
      offset += length;
      continue;
    } else offset += graphemes(node.value).length;
  }
  return null;
}

/** Apply a presentation to a selected Ruby sub-part. Ruby selection has its own grapheme domain. */
export function applyRubyPresentation(document, range, presentation) {
  const part = range?.part === "base" ? "base" : "ruby";
  const nodeIndex = Number.isInteger(Number(range?.nodeIndex)) ? Number(range.nodeIndex) : 0;
  let current = 0; let path = null; let localStart = 0; let localEnd = 0;
  const find = (nodes, parentPath = []) => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]; const nextPath = [...parentPath, index];
      if (node.type === "span") { find(node.children || [], nextPath); if (path) return; }
      else if (node.type === "ruby") {
        if (current++ === nodeIndex) { const normalized = normalizeRubyRange(range, graphemes(part === "base" ? node.base : node.ruby).length); if (normalized) { localStart = normalized.start; localEnd = normalized.end; path = nextPath; } return; }
      }
    }
  };
  find(document?.nodes || []);
  if (!path || localEnd <= localStart) return document;
  return { ...document, nodes: normalizeNodes(applyRubyAtPath(document.nodes || [], path, part, localStart, localEnd, presentation)) };
}

function clearRubyAtPath(nodes, path, part, start, end) {
  const [index, ...rest] = path;
  return nodes.map((node, nodeIndex) => {
    if (nodeIndex !== index) return node;
    if (!rest.length && node.type === "ruby") {
      const key = part === "base" ? "baseDecorations" : "rubyDecorations";
      const decorations = [];
      for (const decoration of node[key] || []) {
        if (decoration.end <= start || decoration.start >= end) decorations.push(decoration);
        else {
          if (decoration.start < start) decorations.push({ ...decoration, end: start });
          if (decoration.end > end) decorations.push({ ...decoration, start: end });
        }
      }
      const next = { ...node }; if (decorations.length) next[key] = decorations; else delete next[key]; return next;
    }
    if (node.type !== "span") return node;
    return { ...node, children: clearRubyAtPath(node.children || [], rest, part, start, end) };
  });
}

export function clearRubyPresentation(document, range) {
  const part = range?.part === "base" ? "base" : "ruby"; const nodeIndex = Number.isInteger(Number(range?.nodeIndex)) ? Number(range.nodeIndex) : 0;
  let current = 0; let path = null; let localStart = 0; let localEnd = 0;
  const find = (nodes, parentPath = []) => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]; const nextPath = [...parentPath, index];
      if (node.type === "span") { find(node.children || [], nextPath); if (path) return; }
      else if (node.type === "ruby") {
        if (current++ === nodeIndex) { const normalized = normalizeRubyRange(range, graphemes(part === "base" ? node.base : node.ruby).length); if (normalized) { localStart = normalized.start; localEnd = normalized.end; path = nextPath; } return; }
      }
    }
  };
  find(document?.nodes || []); if (!path || localEnd <= localStart) return document;
  return { ...document, nodes: normalizeNodes(clearRubyAtPath(document.nodes || [], path, part, localStart, localEnd)) };
}

export function applyPresentation(document, range, presentation) {
  const start = Math.max(0, Number(range?.start) || 0); const end = Math.max(start, Number(range?.end) || 0);
  const partialRuby = findPartialRuby(document?.nodes || [], start, end);
  if (partialRuby) return { ...document, nodes: normalizeNodes(applyRubyAtPath(document.nodes || [], partialRuby.path, partialRuby.part, partialRuby.start, partialRuby.end, presentation)) };
  const parts = partitionDocument(document, range);
  if (parts.start === parts.end || !parts.selected.length) return document;
  const applied = parts.selected.flatMap(node => node.type === "span" ? overlay([node], presentation) : wrap([node], presentation));
  return { ...document, nodes: normalizeNodes([...parts.before, ...applied, ...parts.after]) };
}
export function clearPresentation(document, range) {
  const start = Math.max(0, Number(range?.start) || 0); const end = Math.max(start, Number(range?.end) || 0);
  const partialRuby = findPartialRuby(document?.nodes || [], start, end);
  if (partialRuby) return { ...document, nodes: normalizeNodes(clearRubyAtPath(document.nodes || [], partialRuby.path, partialRuby.part, partialRuby.start, partialRuby.end)) };
  const parts = partitionDocument(document, range);
  if (parts.start === parts.end) return document;
  return { ...document, nodes: normalizeNodes([...parts.before, ...stripPresentation(parts.selected), ...parts.after]) };
}
