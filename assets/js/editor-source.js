import { graphemes } from "./syntax-adapter.js";

/**
 * Convert rendered editor DOM back to Author Source without treating view-only
 * glyph/transform output as source text. The adapter format is supplied by the
 * caller so editing a legacy document cannot silently emit vNext markup.
 */
export function serializeEditedNode(node, inPresentationTarget = false, format = "narou-text", options = {}) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node.tagName === "BR") return "\n";
  if (node.classList?.contains("view-warning")) return "";
  if (node.classList?.contains("source-presentation")) {
    if (node.dataset?.sourceRaw && (node.dataset.glyphType === "text" || node.dataset.glyphType === "font" || node.dataset.glyphFailed === "true" || node.querySelector?.(".source-glyph"))) return node.dataset.sourceRaw;
    if (node.dataset?.glyphFallback && node.textContent === node.dataset.glyphFallback && node.dataset.sourceRaw) return node.dataset.sourceRaw;
    const attrs = presentationAttributes(node);
    const inner = [...(node.childNodes || [])].map(child => serializeEditedNode(child, true, format, options)).join("");
    return presentationWrap(inner, attrs, format);
  }
  if (node.classList?.contains("source-text")) return escapeAuthorText(node.textContent || "", inPresentationTarget);
  if (node.classList?.contains("source-char")) return escapeAuthorText(node.textContent || "", inPresentationTarget);
  if (node.classList?.contains("source-ruby")) {
    const ruby = node.querySelector?.("ruby");
    if (node.dataset?.sourceRaw && !ruby) return node.dataset.sourceRaw;
    if (options.preserveRuby !== false && !options.editRuby && node.dataset?.sourceRaw) return inPresentationTarget ? node.dataset.sourceRaw.replace(rubyCore(node.dataset, false), rubyCore(node.dataset, true)) : node.dataset.sourceRaw;
    if (ruby) {
      const rt = ruby.querySelector("rt");
      const base = [...ruby.childNodes].filter(child => child !== rt).map(child => child.textContent || "").join("");
      const rubyText = rt?.textContent || "";
      if (base === (node.dataset?.sourceBase || "") && rubyText === (node.dataset?.sourceRuby || "") && node.dataset?.sourceRaw) return node.dataset.sourceRaw.replace(rubyCore(node.dataset, false), rubyCore(node.dataset, inPresentationTarget));
      if (base && rubyText) return serializeRubyWithDecorations(node, base, rubyText, inPresentationTarget, format);
    }
    return node.textContent === node.dataset.sourceBase ? (node.dataset.sourceRaw || escapeRubyPart(node.textContent || "", inPresentationTarget)) : escapeRubyPart(node.textContent || "", inPresentationTarget);
  }
  return [...(node.childNodes || [])].map(child => serializeEditedNode(child, inPresentationTarget, format, options)).join("");
}

function isLegacyFormat(format) { return format === "narou" || format === "narou-legacy"; }

function presentationWrap(inner, attrs, format) {
  if (!attrs.length) return inner;
  return isLegacyFormat(format) ? `[${inner}]{${attrs.join(",")}}` : `[${inner}:${attrs.join(",")}]`;
}

function presentationAttributes(node, prefix = "") {
  const key = value => prefix ? `${prefix}-${value}` : value;
  const attrs = [];
  if (node.dataset?.palette) attrs.push(`${key("c")}=${node.dataset.palette}`);
  if (node.dataset?.bank) attrs.push(`${key("bank")}=${node.dataset.bank}`);
  const styles = (node.dataset?.styles || node.dataset?.style || "").split(",").map(value => value.trim()).filter(Boolean);
  for (const style of styles) attrs.push(`${key("style")}=${style}`);
  if (node.dataset?.glyph) attrs.push(`${key("glyph")}=${node.dataset.glyph}`);
  if (node.dataset?.font) attrs.push(`${key("font")}=${node.dataset.font}`);
  if (node.dataset?.weight) attrs.push(`${key("weight")}=${node.dataset.weight}`);
  if (node.dataset?.outline) attrs.push(`${key("outline")}=${node.dataset.outline}`);
  if (node.dataset?.gradient) attrs.push(`${key("gradient")}=${node.dataset.gradient}`);
  if (node.dataset?.combine) attrs.push(node.dataset.combine === "straight" ? key("combine") : `${key("combine")}=${node.dataset.combine}`);
  else if (node.classList?.contains("combine")) attrs.push(key("combine"));
  return attrs;
}

function rubyDecorationMarkers(node, part, length) {
  const markers = [...(node.querySelectorAll?.(`.ruby-presentation-part[data-ruby-part="${part}"][data-ruby-start][data-ruby-end]`) || [])];
  const result = [];
  for (const marker of markers) {
    const start = Math.max(0, Math.min(length, Number(marker.dataset.rubyStart)));
    const end = Math.max(start, Math.min(length, Number(marker.dataset.rubyEnd)));
    const attrs = presentationAttributes(marker, part);
    if (end <= start || !attrs.length) continue;
    const previous = result.at(-1);
    if (previous?.end === start && previous.attrs.join(",") === attrs.join(",")) previous.end = end;
    else result.push({ start, end, attrs });
  }
  return result;
}

function serializeRubyWithDecorations(node, base, rubyText, inPresentationTarget, format) {
  let result = `${node.dataset.sourceExplicit === "true" ? "｜" : ""}${escapeRubyPart(base, inPresentationTarget)}《${escapeRubyPart(rubyText, inPresentationTarget)}》`;
  const decorations = [
    ...rubyDecorationMarkers(node, "base", graphemes(base).length).map(decoration => ({ ...decoration, scope: "base" })),
    ...rubyDecorationMarkers(node, "ruby", graphemes(rubyText).length).map(decoration => ({ ...decoration, scope: "ruby" }))
  ];
  for (const decoration of decorations) result = presentationWrap(result, [`${decoration.scope}-range=${decoration.start}-${decoration.end}`, ...decoration.attrs], format);
  return result;
}

function escapeRubyPart(value, inPresentationTarget = false) {
  const pattern = inPresentationTarget ? /[\\\[\]:{}｜《》]/g : /[\\\[\]｜《》]/g;
  return String(value).replace(pattern, match => `\\${match}`);
}

function rubyCore(dataset, inPresentationTarget) {
  return `${dataset.sourceExplicit === "true" ? "｜" : ""}${escapeRubyPart(dataset.sourceBase || "", inPresentationTarget)}《${escapeRubyPart(dataset.sourceRuby || "", inPresentationTarget)}》`;
}

function escapeAuthorText(value, inPresentationTarget = false) {
  const pattern = inPresentationTarget ? /[\\\[\]:{}｜《》]/g : /[\\\[\]｜《》]/g;
  return String(value).replace(pattern, match => `\\${match}`);
}

export function renderedBodySource(container, adapterOrFormat = "narou-text", options = {}) {
  const format = typeof adapterOrFormat === "string" ? adapterOrFormat : adapterOrFormat?.id || "narou-text";
  const blockTags = new Set(["DIV", "P", "LI", "SECTION", "ARTICLE"]);
  const parts = [];
  for (const node of container?.childNodes || []) {
    const value = serializeEditedNode(node, false, format, options);
    if (blockTags.has(node.nodeType === 1 ? node.tagName : "")) parts.push(value);
    else if (parts.length) parts[parts.length - 1] += value;
    else parts.push(value);
  }
  return parts.join("\n").replace(/\u00a0/g, " ");
}
