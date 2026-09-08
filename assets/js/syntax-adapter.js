// @ts-check
import { parseRuby } from "./ruby-parser.js?v=20260908-016";

/** @typedef {{type: "text", value: string}} TextNode */
/** @typedef {{type: "ruby", base: string, ruby: string, explicit: boolean}} RubyNode */
/** @typedef {{type: "span", children: ReaderNode[], presentation: Presentation}} SpanNode */
/** @typedef {TextNode|RubyNode|SpanNode} ReaderNode */
/** @typedef {{color?: {type: "palette", index: number}, style?: {type: "style", name: string}, glyph?: {type: "glyph", name: string}, combine?: boolean}} Presentation */
/** @typedef {{type: "document", nodes: ReaderNode[]}} ReaderDocument */

export const PARSER_LIMITS = Object.freeze({ maxDepth: 32, maxNodes: 100_000, maxAttributes: 16 });

/** Count user-visible grapheme clusters, never UTF-16 code units. */
export function graphemes(value) {
  const text = String(value ?? "");
  if (globalThis.Intl?.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(item => item.segment);
  return Array.from(text);
}

/** Syntax-independent boundary between Author Source and Reader Core. */
export const narouTextAdapter = Object.freeze({
  id: "narou-text",
  capabilities: Object.freeze({ ruby: true, presentationMarkup: true, provisionalSyntax: true, escapedLiterals: true, nestedPresentation: true, graphemeBoundaries: true }),
  parse(source) { return { type: "document", nodes: parseProvisional(String(source)) }; },
  serialize(document) { return serializeAuthor(normalizeNodes(document?.nodes || [])); },
  toPortableText(document) { return serializePortable(document?.nodes || []); },
  toPlainText(document) { return plainText(document?.nodes || []); },
  validate(source) {
    if (typeof source !== "string") return { valid: false, errors: ["Sourceは文字列である必要があります。"] };
    try { this.parse(source); return { valid: true, errors: [] }; }
    catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : "Sourceを解析できませんでした。"] }; }
  }
});

const syntaxAdapters = Object.freeze({ narou: narouTextAdapter, "narou-text": narouTextAdapter });
export function getSyntaxAdapter(format = "narou-text") {
  const adapter = syntaxAdapters[String(format || "narou-text")];
  if (!adapter) throw new Error(`未対応の本文formatです: ${format}`);
  return adapter;
}
export function assertCapabilities(adapter, required = {}) {
  for (const [capability, enabled] of Object.entries(required)) if (enabled && !adapter?.capabilities?.[capability]) throw new Error(`Syntax Adapterが${capability}に対応していません。`);
  return adapter;
}

function parsePresentation(source) {
  const presentation = {};
  const parts = source.split(",").map(value => value.trim()).filter(Boolean);
  if (parts.length > PARSER_LIMITS.maxAttributes) throw new Error("Presentation属性が多すぎます。");
  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    if (key === "c" && /^\d+$/.test(value)) presentation.color = { type: "palette", index: Number(value) };
    else if (key === "style" && /^[\w-]+$/.test(value)) presentation.style = { type: "style", name: value };
    else if (key === "glyph" && /^[\w-]+$/.test(value)) presentation.glyph = { type: "glyph", name: value };
    else if (key === "combine" && !value) presentation.combine = true;
    else throw new Error(`未対応または不正なPresentation指定です: ${part}`);
  }
  return presentation;
}

function decodeEscapes(value) { return String(value).replace(/\\([\\\[\]{}])/g, "$1"); }
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

function matching(source, start, open, close) {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === open) depth++;
    if (source[index] === close && --depth === 0) return index;
  }
  return -1;
}

function parseProvisional(source, depth = 0, stats = { nodes: 0 }) {
  if (depth > PARSER_LIMITS.maxDepth) throw new Error("Presentationの入れ子が深すぎます。");
  const nodes = [];
  let cursor = 0;
  let plainStart = 0;
  const flushPlain = end => {
    if (end <= plainStart) return;
    appendNodes(nodes, restoreRubyEscapes(parseRuby(protectRubyEscapes(source.slice(plainStart, end)))), stats);
  };
  while (cursor < source.length) {
    if (source[cursor] !== "[" || (cursor > 0 && source[cursor - 1] === "\\")) { cursor++; continue; }
    const closeBracket = matching(source, cursor, "[", "]");
    if (closeBracket < 0 || source[closeBracket + 1] !== "{") { cursor++; continue; }
    const closeAttribute = matching(source, closeBracket + 1, "{", "}");
    if (closeAttribute < 0) { cursor++; continue; }
    flushPlain(cursor);
    const presentation = parsePresentation(decodeEscapes(source.slice(closeBracket + 2, closeAttribute)));
    const children = parseProvisional(source.slice(cursor + 1, closeBracket), depth + 1, stats);
    if (Object.keys(presentation).length) appendNodes(nodes, [{ type: "span", children, presentation }], stats);
    else appendNodes(nodes, children, stats);
    cursor = closeAttribute + 1;
    plainStart = cursor;
  }
  flushPlain(source.length);
  return normalizeNodes(nodes);
}

function escapeLiteral(value) { return String(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\{/g, "\\{").replace(/\}/g, "\\}"); }
function serializeAuthor(nodes) {
  return nodes.map(node => {
    if (node.type === "span") {
      const attrs = [];
      if (node.presentation?.color) attrs.push(`c=${node.presentation.color.index}`);
      if (node.presentation?.style) attrs.push(`style=${node.presentation.style.name}`);
      if (node.presentation?.glyph) attrs.push(`glyph=${node.presentation.glyph.name}`);
      if (node.presentation?.combine) attrs.push("combine");
      return `[${serializeAuthor(node.children || [])}]{${attrs.join(",")}}`;
    }
    if (node.type === "ruby") return `${node.explicit ? "｜" : ""}${node.base}《${node.ruby}》`;
    return escapeLiteral(node.value);
  }).join("");
}
function serializePortable(nodes) { return nodes.map(node => node.type === "span" ? serializePortable(node.children || []) : node.type === "ruby" ? `${node.explicit ? "｜" : ""}${node.base}《${node.ruby}》` : node.value).join(""); }
function plainText(nodes) { return nodes.map(node => node.type === "span" ? plainText(node.children || []) : node.type === "ruby" ? node.base : node.value).join(""); }

export function parseSource(source, adapter = narouTextAdapter) { return adapter.parse(source); }
export function serializeSource(document, adapter = narouTextAdapter) { return adapter.serialize(document); }
export function toPortableText(document, adapter = narouTextAdapter) { return adapter.toPortableText(document); }
export function toPlainText(document, adapter = narouTextAdapter) { return adapter.toPlainText(document); }
export function validateSource(source, adapter = narouTextAdapter) { return adapter.validate(source); }
export function nodeLength(node) { return node.type === "span" ? (node.children || []).reduce((sum, child) => sum + nodeLength(child), 0) : graphemes(node.type === "ruby" ? node.base : node.value).length; }

function samePresentation(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
export function normalizeNodes(nodes = []) {
  const result = [];
  for (const raw of nodes) {
    if (!raw) continue;
    const node = raw.type === "span" ? { ...raw, children: normalizeNodes(raw.children || []) } : { ...raw };
    if (node.type === "span" && !node.children.length) continue;
    const previous = result.at(-1);
    if (node.type === "text" && previous?.type === "text") previous.value += node.value;
    else if (node.type === "span" && previous?.type === "span" && samePresentation(previous.presentation, node.presentation)) previous.children.push(...node.children);
    else result.push(node);
  }
  return result;
}

function wrap(nodes, presentation) { return nodes.length ? [{ type: "span", children: nodes, presentation: structuredClone(presentation || {}) }] : []; }
function overlay(nodes, presentation) { return nodes.map(node => node.type === "span" ? { ...node, presentation: { ...(node.presentation || {}), ...(structuredClone(presentation || {})) } } : node); }

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
  const selectedWithPresentation = selected.flatMap(child => child.type === "span" ? overlay([child], node.presentation) : wrap([child], node.presentation));
  return { before: wrap(before, node.presentation), selected: selectedWithPresentation, after: wrap(after, node.presentation) };
}

function partitionDocument(document, range) {
  const start = Math.max(0, Number(range?.start) || 0); const end = Math.max(start, Number(range?.end) || 0);
  const before = []; const selected = []; const after = []; let offset = 0;
  for (const node of document?.nodes || []) { const part = partitionNode(node, start - offset, end - offset); before.push(...part.before); selected.push(...part.selected); after.push(...part.after); offset += nodeLength(node); }
  return { before, selected, after, start, end };
}

function stripPresentation(nodes) { return nodes.flatMap(node => node.type === "span" ? stripPresentation(node.children || []) : [node]); }

export function applyPresentation(document, range, presentation) {
  const parts = partitionDocument(document, range);
  if (parts.start === parts.end || !parts.selected.length) return document;
  const applied = parts.selected.flatMap(node => node.type === "span" ? overlay([node], presentation) : wrap([node], presentation));
  return { ...document, nodes: normalizeNodes([...parts.before, ...applied, ...parts.after]) };
}
export function clearPresentation(document, range) {
  const parts = partitionDocument(document, range);
  if (parts.start === parts.end) return document;
  return { ...document, nodes: normalizeNodes([...parts.before, ...stripPresentation(parts.selected), ...parts.after]) };
}
