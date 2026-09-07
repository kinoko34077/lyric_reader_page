import { parseSource, serializeSource, toPortableText } from "./syntax-adapter.js";
import { transformNodes } from "./transformer.js";

export function renderLyrics(element, source, options) {
  const sourceNodes = parseSource(source).nodes;
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
      wrapper.dataset.sourceRaw = serializeSource({ type: "document", nodes: [sourceNode] });
      if (node.presentation?.combine) wrapper.classList.add("combine");
      if (node.presentation?.glyph) { wrapper.classList.add("has-glyph"); wrapper.dataset.glyph = node.presentation.glyph.name; }
      if (node.presentation?.style) { wrapper.classList.add("has-style"); wrapper.dataset.style = node.presentation.style.name; }
      if (node.presentation?.color) wrapper.dataset.palette = String(node.presentation.color.index);
      renderNodes(node.children || [], sourceNode.children || [], wrapper);
      wrapper.dataset.sourceEnd = offset; Object.assign(wrapper.style, annotationStyle(start, offset)); parent.append(wrapper); return;
    }
    if (node.type === "text") { const sourceChars = [...(sourceNode.value || node.value)]; for (let charIndex = 0; charIndex < [...node.value].length; charIndex += 1) { const span = document.createElement("span"); span.className = "source-char"; span.dataset.sourceStart = offset; span.dataset.sourceEnd = offset + 1; span.dataset.sourceRaw = sourceChars[charIndex] || [...node.value][charIndex]; span.textContent = [...node.value][charIndex]; Object.assign(span.style, annotationStyle(offset, offset + 1)); parent.append(span); offset += 1; } return; }
    const end = offset + [...node.base].length; const wrapper = document.createElement("span"); wrapper.className = "source-ruby"; wrapper.dataset.sourceStart = offset; wrapper.dataset.sourceEnd = end; wrapper.dataset.sourceRaw = serializeSource({ type: "document", nodes: [sourceNode] }); wrapper.dataset.sourceBase = node.base; wrapper.dataset.sourceExplicit = String(sourceNode.explicit); Object.assign(wrapper.style, annotationStyle(offset, end));
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
    const length = [...(node.type === "text" ? node.value : node.base)].length;
    const end = offset + length;
    if (end <= range.start || offset >= range.end) { offset = end; return []; }
    if (node.type === "text") {
      const from = Math.max(0, range.start - offset);
      const to = Math.min(length, range.end - offset);
      offset = end; return [{ type: "text", value: [...node.value].slice(from, to).join("") }];
    }
    offset = end;
    return [node];
  });
  selected.push(...collect(nodes));
  return toPortableText({ type: "document", nodes: selected });
}
