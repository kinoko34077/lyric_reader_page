import test from "node:test";
import assert from "node:assert/strict";
import { renderLyrics } from "../assets/js/reader-view.js";
import { renderedBodySource } from "../assets/js/editor-source.js";
import { parseJsonText } from "../assets/js/data-loader.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  toggle(name, force) { const next = force === undefined ? !this.values.has(name) : force; if (next) this.values.add(name); else this.values.delete(name); return next; }
  contains(name) { return this.values.has(name); }
}

class FakeNode {
  constructor(tagName = "#fragment", nodeType = 1, value = "") { this.tagName = tagName; this.nodeType = nodeType; this.nodeValue = nodeType === 3 ? value : null; this.childNodes = []; this.dataset = {}; this.style = {}; this.classList = new FakeClassList(); this.listeners = {}; }
  set className(value) { this.classList = new FakeClassList(); this.classList.add(...String(value || "").split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(" "); }
  append(...children) { this.childNodes.push(...children.flatMap(child => child?.nodeType === 11 ? child.childNodes.splice(0) : [child]).filter(Boolean)); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(child => child.textContent || child.nodeValue || "").join(""); }
  set textContent(value) { this.replaceChildren(new FakeNode("#text", 3, String(value))); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatchEvent(event) { for (const listener of this.listeners[event.type] || []) listener.call(this, event); }
  closest() { return null; }
  querySelectorAll(selector) { const found = []; const visit = node => { if (selector === "[data-source-start]" && node.dataset?.sourceStart) found.push(node); if (selector.includes(".ruby-presentation-part") && node.classList?.contains("ruby-presentation-part")) found.push(node); node.childNodes?.forEach(visit); }; this.childNodes.forEach(visit); return found; }
  querySelector(selector) { if (selector === "ruby" || selector === "rt") { let found = null; const visit = node => { if (found) return; if (node.tagName?.toLowerCase() === selector) { found = node; return; } node.childNodes?.forEach(visit); }; this.childNodes.forEach(visit); return found; } return null; }
}

function installDocument() {
  const previous = globalThis.document;
  globalThis.document = { createDocumentFragment: () => new FakeNode("#fragment", 11), createElement: tag => new FakeNode(tag.toUpperCase()), createTextNode: value => new FakeNode("#text", 3, value) };
  return () => { globalThis.document = previous; };
}

test("rendered DOM round-trips through Author Source and Reader JSON", () => {
  const restore = installDocument();
  try {
    const container = new FakeNode("DIV");
    const source = "題\n[如何《どう》:c=2,style=shout]";
    renderLyrics(container, source, { mode: "writer", registry: { styles: { shout: { weight: "700" } } }, preserveSource: true });
    const sourceFromDom = renderedBodySource(container);
    assert.equal(sourceFromDom, source);
    const json = JSON.stringify({ version: 3, content: { format: "narou-text", variants: [{ id: "a", label: "原文", source: { text: sourceFromDom } }] }, meta: { title: "題" }, registry: { styles: { shout: { weight: "700" } } } });
    const loaded = parseJsonText(json, "reader-document");
    assert.equal(loaded.content.variants[0].source.text, source);
    assert.equal(loaded.registry.styles.shout.weight, "700");
  } finally { restore(); }
});

test("failed image Glyph rendering restores portable Ruby Source", () => {
  const restore = installDocument();
  try {
    const container = new FakeNode("DIV");
    renderLyrics(container, "[如何《どう》:glyph=missing]", { mode: "viewer", registry: { glyphs: { missing: { type: "image", src: "https://reader.example.test/missing.svg" } } } });
    const wrapper = container.childNodes[0];
    const image = wrapper.childNodes[0];
    assert.equal(image.tagName, "IMG");
    image.dispatchEvent({ type: "error" });
    assert.equal(wrapper.textContent, "如何《どう》");
    assert.equal(wrapper.dataset.glyphFailed, "true");
  } finally { restore(); }
});
