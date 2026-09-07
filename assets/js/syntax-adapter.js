// @ts-check
import { parseRuby } from "./ruby-parser.js";

/** @typedef {{type: "text", value: string}} TextNode */
/** @typedef {{type: "ruby", base: string, ruby: string, explicit: boolean}} RubyNode */
/** @typedef {{type: "span", children: ReaderNode[], presentation: Presentation}} SpanNode */
/** @typedef {TextNode|RubyNode|SpanNode} ReaderNode */
/** @typedef {{color?: {type: "palette", index: number}, style?: {type: "style", name: string}, glyph?: {type: "glyph", name: string}, combine?: boolean}} Presentation */
/** @typedef {{type: "document", nodes: ReaderNode[]}} ReaderDocument */

/** Syntax-independent boundary between Author Source and Reader Core. */
export const narouTextAdapter = Object.freeze({
  id: "narou-text",
  capabilities: Object.freeze({ ruby: true, presentationMarkup: true, provisionalSyntax: true }),
  /** @returns {ReaderDocument} */
  parse(source) { return { type: "document", nodes: parseProvisional(String(source)) }; },
  serialize(document) { return serializeAuthor(document?.nodes || []); },
  toPortableText(document) { return serializePortable(document?.nodes || []); },
  toPlainText(document) { return plainText(document?.nodes || []); },
  validate(source) {
    if (typeof source !== "string") return { valid: false, errors: ["Sourceは文字列である必要があります。"] };
    try { this.parse(source); return { valid: true, errors: [] }; }
    catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : "Sourceを解析できませんでした。"] }; }
  }
});

const syntaxAdapters = Object.freeze({ "narou": narouTextAdapter, "narou-text": narouTextAdapter });
export function getSyntaxAdapter(format = "narou-text") {
  const adapter = syntaxAdapters[String(format || "narou-text")];
  if (!adapter) throw new Error(`未対応の本文formatです: ${format}`);
  return adapter;
}

/** @returns {Presentation} */
function parsePresentation(source) {
  const presentation = {};
  for (const part of source.split(",").map(value => value.trim()).filter(Boolean)) {
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

/** @returns {ReaderNode[]} */
function parseProvisional(source) {
  const nodes = [];
  const pattern = /\[([^\]\n]+)\]\{([^{}\n]*)\}/gu;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) nodes.push(...parseRuby(source.slice(cursor, match.index)));
    const presentation = parsePresentation(match[2]);
    const children = parseProvisional(match[1]);
    if (Object.keys(presentation).length) nodes.push({ type: "span", children, presentation });
    else nodes.push(...children);
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) nodes.push(...parseRuby(source.slice(cursor)));
  return nodes;
}

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
    return node.value;
  }).join("");
}

function serializePortable(nodes) {
  return nodes.map(node => node.type === "span" ? serializePortable(node.children || []) : node.type === "ruby" ? `${node.explicit ? "｜" : ""}${node.base}《${node.ruby}》` : node.value).join("");
}

function plainText(nodes) {
  return nodes.map(node => node.type === "span" ? plainText(node.children || []) : node.type === "ruby" ? node.base : node.value).join("");
}

export function parseSource(source, adapter = narouTextAdapter) { return adapter.parse(source); }
export function serializeSource(document, adapter = narouTextAdapter) { return adapter.serialize(document); }
export function toPortableText(document, adapter = narouTextAdapter) { return adapter.toPortableText(document); }
export function toPlainText(document, adapter = narouTextAdapter) { return adapter.toPlainText(document); }
export function validateSource(source, adapter = narouTextAdapter) { return adapter.validate(source); }

export function nodeLength(node) {
  if (node.type === "span") return (node.children || []).reduce((sum, child) => sum + nodeLength(child), 0);
  return [...(node.type === "ruby" ? node.base : node.value)].length;
}

function wrap(nodes, presentation) { return nodes.length ? [{ type: "span", children: nodes, presentation: structuredClone(presentation || {}) }] : []; }

/** Partition one node into before/selected/after without ever duplicating source characters. */
function partitionNode(node, start, end, unwrapSelected = true) {
  const length = nodeLength(node);
  if (end <= 0) return { before: [], selected: [], after: [node] };
  if (start >= length) return { before: [node], selected: [], after: [] };
  if (node.type === "ruby") {
    // A Ruby is an indivisible semantic unit; a partial selection selects the whole Ruby.
    return { before: [], selected: [node], after: [] };
  }
  if (node.type === "text") {
    const chars = [...node.value]; const from = Math.max(0, start); const to = Math.min(length, end);
    return {
      before: from ? [{ type: "text", value: chars.slice(0, from).join("") }] : [],
      selected: to > from ? [{ type: "text", value: chars.slice(from, to).join("") }] : [],
      after: to < length ? [{ type: "text", value: chars.slice(to).join("") }] : []
    };
  }
  const before = []; const selected = []; const after = []; let offset = 0;
  for (const child of node.children || []) {
    const childLength = nodeLength(child); const part = partitionNode(child, start - offset, end - offset, unwrapSelected);
    before.push(...part.before); selected.push(...part.selected); after.push(...part.after); offset += childLength;
  }
  const presentation = node.presentation;
  return {
    before: wrap(before, presentation),
    selected: unwrapSelected ? selected : wrap(selected, presentation),
    after: wrap(after, presentation)
  };
}

function partitionDocument(document, range) {
  const start = Math.max(0, Number(range?.start) || 0); const end = Math.max(start, Number(range?.end) || 0);
  const before = []; const selected = []; const after = []; let offset = 0;
  for (const node of document?.nodes || []) {
    const length = nodeLength(node); const part = partitionNode(node, start - offset, end - offset);
    before.push(...part.before); selected.push(...part.selected); after.push(...part.after); offset += length;
  }
  return { before, selected, after, start, end };
}

/** Apply semantic Presentation to a source range, keeping Source as the only edited document. */
export function applyPresentation(document, range, presentation) {
  const parts = partitionDocument(document, range);
  if (parts.start === parts.end || !parts.selected.length) return document;
  return { ...document, nodes: [...parts.before, { type: "span", children: parts.selected, presentation: structuredClone(presentation || {}) }, ...parts.after] };
}

/** Remove any Presentation crossing a source range; plain Source children remain intact. */
export function clearPresentation(document, range) {
  const parts = partitionDocument(document, range);
  if (parts.start === parts.end) return document;
  return { ...document, nodes: [...parts.before, ...parts.selected, ...parts.after] };
}
