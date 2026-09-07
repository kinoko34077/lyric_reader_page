import { parseRuby, serializeRuby } from "./ruby-parser.js";
import { transformNodes } from "./transformer.js";

export function renderLyrics(element, source, options) {
  const nodes = transformNodes(parseRuby(source), options.kanji);
  element.replaceChildren();
  const fragment = document.createDocumentFragment();
  let offset = 0;
  const annotationStyle = (start, end) => (options.annotations || []).filter(annotation => annotation.range.end > start && annotation.range.start < end).map(annotation => annotation.style || {}).reduce((style, next) => ({ ...style, ...next }), {});
  for (const node of nodes) {
    if (node.type === "text") { for (const char of [...node.value]) { const span = document.createElement("span"); span.className = "source-char"; span.dataset.sourceStart = offset; span.dataset.sourceEnd = offset + 1; span.dataset.sourceRaw = char; span.textContent = char; Object.assign(span.style, annotationStyle(offset, offset + 1)); fragment.append(span); offset += 1; } continue; }
    const end = offset + [...node.base].length; const wrapper = document.createElement("span"); wrapper.className = "source-ruby"; wrapper.dataset.sourceStart = offset; wrapper.dataset.sourceEnd = end; wrapper.dataset.sourceRaw = serializeRuby([node]); wrapper.dataset.sourceBase = node.base; wrapper.dataset.sourceExplicit = String(node.explicit); Object.assign(wrapper.style, annotationStyle(offset, end));
    if (options.ruby) { const ruby = document.createElement("ruby"); ruby.append(document.createTextNode(node.base)); const rt = document.createElement("rt"); rt.textContent = node.ruby; ruby.append(rt); wrapper.append(ruby); } else wrapper.textContent = node.base;
    fragment.append(wrapper); offset = end;
  }
  element.append(fragment);
  element.classList.toggle("is-vertical", options.writingMode === "vertical");
  return nodes;
}

export function rawText(nodes, range = null) {
  if (!range) return serializeRuby(nodes);
  const selected = [];
  let offset = 0;
  for (const node of nodes) {
    const length = [...(node.type === "text" ? node.value : node.base)].length;
    const end = offset + length;
    if (end <= range.start || offset >= range.end) { offset = end; continue; }
    if (node.type === "text") {
      const from = Math.max(0, range.start - offset);
      const to = Math.min(length, range.end - offset);
      selected.push({ type: "text", value: [...node.value].slice(from, to).join("") });
    } else selected.push(node);
    offset = end;
  }
  return serializeRuby(selected);
}
