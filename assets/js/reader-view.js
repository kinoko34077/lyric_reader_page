import { parseRuby, serializeRuby } from "./ruby-parser.js";
import { transformNodes } from "./transformer.js";

export function renderLyrics(element, source, options) {
  const nodes = transformNodes(parseRuby(source), options.kanji);
  element.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === "text") { fragment.append(document.createTextNode(node.value)); continue; }
    if (options.ruby) { const ruby = document.createElement("ruby"); ruby.append(document.createTextNode(node.base)); const rt = document.createElement("rt"); rt.textContent = node.ruby; ruby.append(rt); fragment.append(ruby); }
    else fragment.append(document.createTextNode(node.base));
  }
  element.append(fragment);
  element.classList.toggle("is-vertical", options.writingMode === "vertical");
  return nodes;
}

export function rawText(nodes) { return serializeRuby(nodes); }
