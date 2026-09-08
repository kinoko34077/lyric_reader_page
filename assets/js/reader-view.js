import { getSyntaxAdapter, graphemes, nodeLength, parseSource, serializeSource, toPortableText } from "./syntax-adapter.js?v=20260908-016";
import { transformNodes } from "./transformer.js?v=20260908-016";
import { resolvePresentation } from "./registry.js?v=20260908-016";

export function renderLyrics(element, source, options) {
  const adapter = options.adapter || getSyntaxAdapter(options.format || "narou-text");
  const sourceNodes = parseSource(source, adapter).nodes;
  const nodes = transformNodes(sourceNodes, options.kanji);
  element.replaceChildren();
  const fragment = document.createDocumentFragment();
  let offset = 0;
  const annotationStyle = (start, end) => (options.annotations || []).filter(annotation => annotation.range.end > start && annotation.range.start < end).map(annotation => annotation.style || {}).reduce((style, next) => ({ ...style, ...next }), {});
  const renderNodes = (displayNodes, originalNodes, parent) => displayNodes.forEach((node, index) => {
    const sourceNode = originalNodes[index] || node;
    if (node.type === "span") {
      const start = offset; const wrapper = document.createElement("span");
      wrapper.className = "source-presentation"; wrapper.dataset.sourceStart = start;
      wrapper.dataset.sourceRaw = serializeSource({ type: "document", nodes: [sourceNode] }, adapter);
      if (node.presentation?.combine) wrapper.classList.add("combine");
      if (node.presentation?.glyph) { wrapper.classList.add("has-glyph"); wrapper.dataset.glyph = node.presentation.glyph.name; }
      if (node.presentation?.style) { wrapper.classList.add("has-style"); wrapper.dataset.style = node.presentation.style.name; }
      if (node.presentation?.color) wrapper.dataset.palette = String(node.presentation.color.index);
      const resolved = resolvePresentation(node.presentation, options.registry);
      if (resolved.color) wrapper.style.color = resolved.color;
      if (resolved.outline?.color) { wrapper.style.webkitTextStroke = `${resolved.outline.width}em ${resolved.outline.color}`; wrapper.style.textStroke = `${resolved.outline.width}em ${resolved.outline.color}`; }
      if (resolved.gradient?.stops?.length > 1) { const directions = { "to-right": "to right", "to-left": "to left", "to-top": "to top", "to-bottom": "to bottom", "to-inline-start": options.writingMode === "vertical" ? "to top" : "to left", "to-inline-end": options.writingMode === "vertical" ? "to bottom" : "to right" }; const stops = resolved.gradient.stops.map(stop => `${stop.color} ${stop.position * 100}%`).join(","); wrapper.style.backgroundImage = `linear-gradient(${directions[resolved.gradient.direction] || "to right"},${stops})`; wrapper.style.backgroundClip = "text"; wrapper.style.webkitBackgroundClip = "text"; if (globalThis.CSS?.supports?.("background-clip", "text") || globalThis.CSS?.supports?.("-webkit-background-clip", "text")) wrapper.style.color = "transparent"; }
      if (resolved.font?.url) wrapper.dataset.fontUrl = resolved.font.url;
      if (resolved.font?.family) wrapper.style.fontFamily = `"${resolved.font.family}"`;
      if (resolved.glyphText) wrapper.dataset.glyphFallback = resolved.glyphText;
      renderNodes(node.children || [], sourceNode.children || [], wrapper);
      if (resolved.glyphText) wrapper.replaceChildren(document.createTextNode(resolved.glyphText));
      wrapper.dataset.sourceEnd = offset; Object.assign(wrapper.style, annotationStyle(start, offset)); parent.append(wrapper); return;
    }
      if (node.type === "text") { const sourceValue = sourceNode.value || node.value; const start = offset; const end = start + graphemes(sourceValue).length; const span = document.createElement("span"); span.className = "source-text"; span.dataset.sourceStart = start; span.dataset.sourceEnd = end; span.textContent = node.value; Object.assign(span.style, annotationStyle(start, end)); parent.append(span); offset = end; return; }
    const end = offset + nodeLength(sourceNode); const wrapper = document.createElement("span"); wrapper.className = "source-ruby"; wrapper.dataset.sourceStart = offset; wrapper.dataset.sourceEnd = end; wrapper.dataset.sourceRaw = serializeSource({ type: "document", nodes: [sourceNode] }, adapter); wrapper.dataset.sourceBase = node.base; wrapper.dataset.sourceExplicit = String(sourceNode.explicit); Object.assign(wrapper.style, annotationStyle(offset, end));
    if (options.ruby) { const ruby = document.createElement("ruby"); ruby.append(document.createTextNode(node.base)); const rt = document.createElement("rt"); rt.textContent = node.ruby; ruby.append(rt); wrapper.append(ruby); } else wrapper.textContent = node.base;
    parent.append(wrapper); offset = end;
  });
  renderNodes(nodes, sourceNodes, fragment);
  element.append(fragment);
  element.classList.toggle("is-vertical", options.writingMode === "vertical");
  return sourceNodes;
}

export function rawText(nodes, range = null) {
  if (!range) return toPortableText({ type: "document", nodes });
  const selected = [];
  let offset = 0;
  const collect = list => list.flatMap(node => {
    if (node.type === "span") return collect(node.children || []);
    const length = nodeLength(node);
    const end = offset + length;
    if (end <= range.start || offset >= range.end) { offset = end; return []; }
    if (node.type === "text") {
      const from = Math.max(0, range.start - offset);
      const to = Math.min(length, range.end - offset);
      offset = end; return [{ type: "text", value: graphemes(node.value).slice(from, to).join("") }];
    }
    offset = end;
    return [node];
  });
  selected.push(...collect(nodes));
      return toPortableText({ type: "document", nodes: selected });
}
