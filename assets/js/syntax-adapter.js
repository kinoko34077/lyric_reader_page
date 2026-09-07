import { parseRuby, serializeRuby } from "./ruby-parser.js";

/** Syntax-independent boundary between Author Source and Reader Core. */
export const narouTextAdapter = Object.freeze({
  id: "narou-text",
  capabilities: Object.freeze({ ruby: true, presentationMarkup: false }),
  parse(source) { return { type: "document", nodes: parseRuby(String(source)) }; },
  serialize(document) { return serializeRuby(document?.nodes || []); },
  toPortableText(document) { return serializeRuby(document?.nodes || []); },
  toPlainText(document) { return (document?.nodes || []).map(node => node.type === "ruby" ? node.base : node.value).join(""); },
  validate(source) {
    if (typeof source !== "string") return { valid: false, errors: ["Sourceは文字列である必要があります。"] };
    try { this.parse(source); return { valid: true, errors: [] }; }
    catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : "Sourceを解析できませんでした。"] }; }
  }
});

export function parseSource(source, adapter = narouTextAdapter) { return adapter.parse(source); }
export function serializeSource(document, adapter = narouTextAdapter) { return adapter.serialize(document); }
export function toPortableText(document, adapter = narouTextAdapter) { return adapter.toPortableText(document); }
export function toPlainText(document, adapter = narouTextAdapter) { return adapter.toPlainText(document); }
export function validateSource(source, adapter = narouTextAdapter) { return adapter.validate(source); }
