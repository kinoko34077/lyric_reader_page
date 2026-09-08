import { getSyntaxAdapter, graphemes, nodeLength, parseSource, serializeSource, toPlainText, toPortableText } from "./syntax-adapter.js";
import { transformNodes } from "./transformer.js";
import { resolvePresentation } from "./registry.js";

function styleFromResolved(element, resolved, writingMode) {
  if (resolved.color) element.style.color = resolved.color;
  if (resolved.weight) element.style.fontWeight = resolved.weight;
  if (resolved.outlines?.length) {
    const [first, ...rest] = resolved.outlines;
    if (first?.color) { element.style.webkitTextStroke = `${first.width}em ${first.color}`; element.style.textStroke = `${first.width}em ${first.color}`; }
    if (rest.length) element.style.textShadow = rest.map(layer => {
      const width = Math.max(0.01, Number(layer.width) || 0.01); return `${width}em 0 0 ${layer.color},-${width}em 0 0 ${layer.color},0 ${width}em 0 ${layer.color},0 -${width}em 0 ${layer.color}`;
    }).join(",");
  }
  if (resolved.gradient?.stops?.length > 1) {
    if (resolved.gradient.fallbackColor) element.style.color = resolved.gradient.fallbackColor;
    const directions = { "to-right": "to right", "to-left": "to left", "to-top": "to top", "to-bottom": "to bottom", "to-inline-start": writingMode === "vertical" ? "to top" : "to left", "to-inline-end": writingMode === "vertical" ? "to bottom" : "to right" };
    const stops = resolved.gradient.stops.map(stop => `${stop.color} ${stop.position * 100}%`).join(",");
    element.style.backgroundImage = `linear-gradient(${directions[resolved.gradient.direction] || "to right"},${stops})`;
    element.style.backgroundClip = "text"; element.style.webkitBackgroundClip = "text";
    if (globalThis.CSS?.supports?.("background-clip", "text") || globalThis.CSS?.supports?.("-webkit-background-clip", "text")) element.style.color = "transparent";
  }
  if (resolved.conflictColors?.length > 1) {
    const direction = writingMode === "vertical" ? "to bottom" : "to right";
    const stops = resolved.conflictColors.map((color, index, colors) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(",");
    element.style.backgroundImage = `linear-gradient(${direction},${stops})`;
    element.style.backgroundClip = "text"; element.style.webkitBackgroundClip = "text";
    if (globalThis.CSS?.supports?.("background-clip", "text") || globalThis.CSS?.supports?.("-webkit-background-clip", "text")) element.style.color = "transparent";
  }
  if (resolved.font?.url) element.dataset.fontUrl = resolved.font.url;
  if (resolved.font?.family) element.style.fontFamily = `"${resolved.font.family}"`;
}

function setPresentationData(element, presentation = {}, resolved) {
  if (presentation.color) element.dataset.palette = String(presentation.color.index);
  if (presentation.bank) element.dataset.bank = presentation.bank.name;
  const styles = Array.isArray(presentation.styles) ? presentation.styles : presentation.style ? [presentation.style] : [];
  if (styles.length) { element.dataset.styles = styles.map(style => style.name).join(","); element.dataset.style = styles[0].name; }
  if (presentation.glyph) { element.dataset.glyph = presentation.glyph.name; element.classList.add("has-glyph"); }
  if (presentation.font) element.dataset.font = presentation.font.name;
  if (presentation.weight) element.dataset.weight = presentation.weight.value;
  if (presentation.outline) element.dataset.outline = presentation.outline.name;
  if (presentation.gradient) element.dataset.gradient = presentation.gradient.name;
  const combine = resolved?.combine || presentation.combine;
  if (combine) {
    const mode = typeof combine === "object" ? combine.mode : "straight";
    element.dataset.combine = mode; element.classList.add("combine", `combine-${mode}`);
  }
  if (resolved?.conflicts?.length) { element.classList.add("presentation-conflict"); element.dataset.conflicts = String(resolved.conflicts.length); }
  styleFromResolved(element, resolved || {}, element.closest?.(".is-vertical") ? "vertical" : "horizontal");
}

function conflictMark(count) {
  return warningMark([`Presentation競合 ${count}件`]);
}

function warningMark(messages = []) {
  const values = [...new Set((Array.isArray(messages) ? messages : [messages]).map(value => String(value || "").trim()).filter(Boolean))];
  const mark = document.createElement("span"); mark.className = "view-warning"; mark.setAttribute("aria-hidden", "true"); mark.textContent = "⃠"; mark.title = values.join(" / "); mark.dataset.warning = mark.title;
  return mark;
}

function appendWarningMark(element, messages) {
  if (!messages?.length) return;
  const existing = [...(element.children || [])].find(child => child.classList?.contains("view-warning"));
  if (existing) {
    const values = existing.dataset.warning ? existing.dataset.warning.split(" / ") : [];
    const merged = [...new Set([...values, ...messages.map(value => String(value || "").trim()).filter(Boolean)])];
    existing.title = merged.join(" / "); existing.dataset.warning = existing.title;
  } else element.append(warningMark(messages));
}

function renderStyleList(presentation = {}) {
  const values = Array.isArray(presentation.styles) ? presentation.styles : presentation.style?.name ? [presentation.style] : [];
  return values.filter(style => style?.name).filter((style, index) => values.findIndex(candidate => candidate?.name === style.name) === index);
}
function mergeRenderedPresentation(base = {}, next = {}) {
  const result = { ...base, ...next };
  const styles = [...renderStyleList(base), ...renderStyleList(next)];
  if (styles.length === 1) { result.style = styles[0]; delete result.styles; }
  else if (styles.length > 1) { result.styles = styles; delete result.style; }
  return result;
}

function decoratedRubyPart(value, decorations, part, sourceStart, rubyIndex, registry, writingMode) {
  const units = graphemes(value); const fragment = document.createDocumentFragment();
  units.forEach((unit, index) => {
    const active = (decorations || []).filter(decoration => decoration.start <= index && decoration.end > index);
    if (!active.length) { fragment.append(document.createTextNode(unit)); return; }
    const presentation = active.reduce((merged, decoration) => mergeRenderedPresentation(merged, decoration.presentation || {}), {});
    const span = document.createElement("span"); span.className = "ruby-presentation-part";
    if (part === "base") { span.dataset.sourceStart = String(sourceStart + index); span.dataset.sourceEnd = String(sourceStart + index + 1); span.dataset.rubyStart = String(index); span.dataset.rubyEnd = String(index + 1); span.dataset.rubyPart = "base"; span.dataset.rubyIndex = String(rubyIndex); }
    else { span.dataset.rubyStart = String(index); span.dataset.rubyEnd = String(index + 1); span.dataset.rubyPart = "ruby"; span.dataset.rubyIndex = String(rubyIndex); }
    const resolved = resolvePresentation(presentation, registry); setPresentationData(span, presentation, resolved); span.textContent = unit; if (resolved.warnings?.length) span.append(warningMark(resolved.warnings)); fragment.append(span);
  });
  return fragment;
}

export function glyphFallbackText(sourceNode) {
  return toPortableText({ type: "document", nodes: sourceNode?.children || [] }) || "";
}

function fontGlyphText(value) {
  const source = String(value || ""); const codepoint = /^U\+([0-9A-F]{1,6})$/i.exec(source);
  if (codepoint) { const number = Number.parseInt(codepoint[1], 16); return number <= 0x10ffff ? String.fromCodePoint(number) : ""; }
  return graphemes(source).length === 1 ? source : "";
}

function splitCombineTextRuns(wrapper) {
  for (const text of [...wrapper.children].filter(child => child.classList.contains("source-text"))) {
    const units = graphemes(text.textContent || ""); if (units.length < 2) continue;
    const start = Number(text.dataset.sourceStart); const fragment = document.createDocumentFragment();
    units.forEach((unit, index) => { const part = document.createElement("span"); part.className = "combine-unit"; part.dataset.sourceStart = String(start + index); part.dataset.sourceEnd = String(start + index + 1); part.textContent = unit; fragment.append(part); });
    text.replaceWith(fragment);
  }
}

function rubyBasePart(value, decorations, sourceStart, rubyIndex, registry, writingMode) {
  const base = document.createElement("span"); base.className = "ruby-base-part"; base.dataset.rubyPart = "base"; base.dataset.rubyIndex = String(rubyIndex); base.dataset.rubyStart = "0"; base.dataset.rubyEnd = String(graphemes(value).length); base.dataset.sourceStart = String(sourceStart); base.dataset.sourceEnd = String(sourceStart + graphemes(value).length);
  base.append(decoratedRubyPart(value, decorations, "base", sourceStart, rubyIndex, registry, writingMode)); return base;
}

export function renderLyrics(element, source, options = {}) {
  const adapter = options.adapter || getSyntaxAdapter(options.format || "narou-text");
  const preserveSource = options.mode !== "viewer" || options.preserveSource === true;
  let sourceNodes;
  let parseWarnings = [];
  try {
    sourceNodes = parseSource(source, adapter).nodes;
  } catch (error) {
    sourceNodes = [{ type: "text", value: String(source ?? "") }];
    parseWarnings = [`Source Presentationを解釈できないため原文へFallbackしました${error instanceof Error ? `: ${error.message}` : "。"}`];
  }
  const nodes = transformNodes(sourceNodes, options.kanji);
  element.replaceChildren();
  const fragment = document.createDocumentFragment(); let offset = 0;
  let rubyIndex = 0;
  const renderNodes = (displayNodes, originalNodes, parent) => displayNodes.forEach((node, index) => {
    const sourceNode = originalNodes[index] || node;
    if (node.type === "span") {
      const start = offset; const wrapper = document.createElement("span"); wrapper.className = "source-presentation"; wrapper.dataset.sourceStart = String(start);
      if (preserveSource) wrapper.dataset.sourceRaw = serializeSource({ type: "document", nodes: [sourceNode] }, adapter);
      const resolved = resolvePresentation(node.presentation, options.registry || {}); setPresentationData(wrapper, node.presentation, resolved);
      renderNodes(node.children || [], sourceNode.children || [], wrapper);
      if (["parallel", "z"].includes(resolved.combine?.mode)) splitCombineTextRuns(wrapper);
      if (resolved.glyph) {
        const fallback = glyphFallbackText(sourceNode); wrapper.dataset.glyphFallback = fallback; wrapper.dataset.glyphType = resolved.glyph.type;
        if (resolved.glyph.type === "text" && resolved.glyph.text) wrapper.replaceChildren(document.createTextNode(resolved.glyph.text));
        else if (["svg", "image"].includes(resolved.glyph.type) && resolved.glyph.src) {
          const image = document.createElement("img"); image.className = "source-glyph"; image.src = resolved.glyph.src; image.alt = ""; image.draggable = false;
          image.addEventListener("error", () => { wrapper.replaceChildren(document.createTextNode(fallback)); wrapper.classList.add("glyph-failed"); wrapper.dataset.glyphFailed = "true"; appendWarningMark(wrapper, [...(resolved.warnings || []), "Glyph Assetの読込に失敗したためSource文字へFallbackしました。"]); }); wrapper.replaceChildren(image);
        } else if (resolved.glyph.type === "font") {
          const fontLoaded = options.loadedRegistryFonts?.has(resolved.glyph.font);
          const replacement = fontLoaded ? fontGlyphText(resolved.glyph.glyph) : "";
          if (replacement) { wrapper.classList.add("glyph-font"); wrapper.replaceChildren(document.createTextNode(replacement)); }
          else { wrapper.replaceChildren(document.createTextNode(fallback)); wrapper.classList.add("glyph-failed"); wrapper.dataset.glyphFailed = "true"; appendWarningMark(wrapper, [...(resolved.warnings || []), "Font Glyphを読み込めないためSource文字へFallbackしました。"]); }
        }
      }
      const fontWarnings = resolved.fontName && options.loadedRegistryFonts instanceof Set && !options.loadedRegistryFonts.has(resolved.fontName) ? [`Font ${resolved.fontName}を読み込めないため標準FontへFallbackしています。`] : [];
      wrapper.dataset.sourceEnd = String(offset); appendWarningMark(wrapper, [...(resolved.warnings || []), ...fontWarnings]); if (resolved.conflicts?.length) wrapper.append(conflictMark(resolved.conflicts.length)); parent.append(wrapper); return;
    }
    if (node.type === "text") {
      const sourceValue = sourceNode.value || node.value; const start = offset; const end = start + graphemes(sourceValue).length; const span = document.createElement("span"); span.className = "source-text"; span.dataset.sourceStart = String(start); span.dataset.sourceEnd = String(end); span.textContent = node.value; parent.append(span); offset = end; return;
    }
    const start = offset; const end = offset + nodeLength(sourceNode); const currentRubyIndex = rubyIndex++; const wrapper = document.createElement("span"); wrapper.className = "source-ruby"; wrapper.dataset.sourceStart = String(start); wrapper.dataset.sourceEnd = String(end); if (preserveSource) wrapper.dataset.sourceRaw = serializeSource({ type: "document", nodes: [sourceNode] }, adapter); wrapper.dataset.sourceBase = sourceNode.base; wrapper.dataset.sourceRuby = sourceNode.ruby; wrapper.dataset.sourceExplicit = String(sourceNode.explicit); wrapper.dataset.rubyIndex = String(currentRubyIndex);
    if (options.ruby !== false) {
      const ruby = document.createElement("ruby"); ruby.append(rubyBasePart(node.base, sourceNode.baseDecorations, start, currentRubyIndex, options.registry || {}, options.writingMode)); const rt = document.createElement("rt"); rt.dataset.rubyPart = "ruby"; rt.dataset.rubyIndex = String(currentRubyIndex); rt.dataset.rubyStart = "0"; rt.dataset.rubyEnd = String(graphemes(node.ruby).length); rt.append(decoratedRubyPart(node.ruby, sourceNode.rubyDecorations, "ruby", start, currentRubyIndex, options.registry || {}, options.writingMode)); ruby.append(rt); wrapper.append(ruby);
    } else wrapper.append(rubyBasePart(node.base, sourceNode.baseDecorations, start, currentRubyIndex, options.registry || {}, options.writingMode));
    parent.append(wrapper); offset = end;
  });
  renderNodes(nodes, sourceNodes, fragment); element.append(fragment); if (parseWarnings.length) element.append(warningMark(parseWarnings)); element.classList.toggle("is-vertical", options.writingMode === "vertical"); return sourceNodes;
}

export function rawText(nodes, range = null) {
  if (!range) return toPortableText({ type: "document", nodes });
  if (range.ruby) {
    let rubyIndex = 0;
    const find = list => {
      for (const node of list) {
        if (node.type === "span") { const found = find(node.children || []); if (found) return found; }
        else if (node.type === "ruby") {
          if (rubyIndex++ === Number(range.ruby.nodeIndex)) return node;
        }
      }
      return null;
    };
    const ruby = find(nodes);
    return ruby ? toPortableText({ type: "document", nodes: [ruby] }) : "";
  }
  const selected = []; let offset = 0;
  const collect = list => list.flatMap(node => {
    if (node.type === "span") return collect(node.children || []);
    const length = nodeLength(node); const end = offset + length;
    if (end <= range.start || offset >= range.end) { offset = end; return []; }
    if (node.type === "text") { const from = Math.max(0, range.start - offset); const to = Math.min(length, range.end - offset); offset = end; return [{ type: "text", value: graphemes(node.value).slice(from, to).join("") }]; }
    offset = end; return [node];
  });
  selected.push(...collect(nodes)); return toPortableText({ type: "document", nodes: selected });
}
