import { parseRuby, serializeRuby } from "./ruby-parser.js";
import { transformNodes } from "./transformer.js";

export function renderLyrics(element, source, options) {
  const nodes = transformNodes(parseRuby(source), options.kanji);
  element.replaceChildren();
  const fragment = document.createDocumentFragment();
  let offset = 0;
  const annotationStyle = (start, end) => (options.annotations || []).filter(annotation => annotation.range.end > start && annotation.range.start < end).map(annotation => annotation.style || {}).reduce((style, next) => ({ ...style, ...next }), {});
  for (const node of nodes) {
    if (node.type === "text") { for (const char of [...node.value]) { const span = document.createElement("span"); span.className = "source-char"; span.dataset.sourceStart = offset; span.dataset.sourceEnd = offset + char.length; span.textContent = char; Object.assign(span.style, annotationStyle(offset, offset + char.length)); fragment.append(span); offset += char.length; } continue; }
    const end = offset + [...node.base].length; const wrapper = document.createElement("span"); wrapper.className = "source-ruby"; wrapper.dataset.sourceStart = offset; wrapper.dataset.sourceEnd = end; Object.assign(wrapper.style, annotationStyle(offset, end));
    if (options.ruby) { const ruby = document.createElement("ruby"); ruby.append(document.createTextNode(node.base)); const rt = document.createElement("rt"); rt.textContent = node.ruby; ruby.append(rt); wrapper.append(ruby); } else wrapper.textContent = node.base;
    fragment.append(wrapper); offset = end;
  }
  element.append(fragment);
  element.classList.toggle("is-vertical", options.writingMode === "vertical");
  return nodes;
}

export function rawText(nodes) { return serializeRuby(nodes); }
