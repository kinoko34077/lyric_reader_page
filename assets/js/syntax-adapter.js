import { parseRuby } from "./ruby-parser.js";

/** Syntax-independent boundary between Author Source and Reader Core. */
export const narouTextAdapter = Object.freeze({
  id: "narou-text",
  capabilities: Object.freeze({ ruby: true, presentationMarkup: true, provisionalSyntax: true }),
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

function parsePresentation(source) {
  const presentation = {};
  for (const part of source.split(",").map(value => value.trim()).filter(Boolean)) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    if (key === "c" && /^\d+$/.test(value)) presentation.color = { type: "palette", index: Number(value) };
    else if (key === "style" && /^[\w-]+$/.test(value)) presentation.style = { type: "style", name: value };
    else if (key === "glyph" && /^[\w-]+$/.test(value)) presentation.glyph = { type: "glyph", name: value };
    else if (key === "combine" && !value) presentation.combine = true;
  }
  return presentation;
}

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
