/**
 * Convert rendered editor DOM back to Author Source without treating view-only
 * glyph/transform output as source text. It intentionally depends only on the
 * small DOM shape emitted by reader-view, so it is testable without a browser.
 */
export function serializeEditedNode(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node.tagName === "BR") return "\n";
  if (node.classList?.contains("source-presentation")) {
    if (node.dataset?.glyphFallback && node.textContent === node.dataset.glyphFallback && node.dataset.sourceRaw) return node.dataset.sourceRaw;
    const attrs = [];
    if (node.dataset?.palette) attrs.push(`c=${node.dataset.palette}`);
    if (node.dataset?.style) attrs.push(`style=${node.dataset.style}`);
    if (node.dataset?.glyph) attrs.push(`glyph=${node.dataset.glyph}`);
    if (node.classList.contains("combine")) attrs.push("combine");
    return `[${[...(node.childNodes || [])].map(serializeEditedNode).join("")}]{${attrs.join(",")}}`;
  }
  if (node.classList?.contains("source-text")) return node.textContent || "";
  if (node.classList?.contains("source-char")) return node.textContent || "";
  if (node.classList?.contains("source-ruby")) {
    const ruby = node.querySelector?.("ruby");
    if (ruby) {
      const rt = ruby.querySelector("rt");
      const base = [...ruby.childNodes].filter(child => child !== rt).map(child => child.textContent || "").join("");
      if (base && rt?.textContent) return `${node.dataset.sourceExplicit === "true" ? "｜" : ""}${base}《${rt.textContent}》`;
    }
    return node.textContent === node.dataset.sourceBase ? (node.dataset.sourceRaw || node.textContent || "") : (node.textContent || "");
  }
  return [...(node.childNodes || [])].map(serializeEditedNode).join("");
}

export function renderedBodySource(container) {
  const blockTags = new Set(["DIV", "P", "LI", "SECTION", "ARTICLE"]);
  const parts = [];
  for (const node of container?.childNodes || []) {
    const value = serializeEditedNode(node);
    if (blockTags.has(node.nodeType === 1 ? node.tagName : "")) parts.push(value);
    else if (parts.length) parts[parts.length - 1] += value;
    else parts.push(value);
  }
  return parts.join("\n").replace(/\u00a0/g, " ");
}
