import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderLyrics } from "../assets/js/reader-view.js";
import { renderedBodySource } from "../assets/js/editor-source.js";
import { parseJsonText } from "../assets/js/data-loader.js";
import { parseSource, toPortableText } from "../assets/js/syntax-adapter.js";

const goldenFixture = fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "reader-kernel-golden.txt"), "utf8");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  toggle(name, force) { const next = force === undefined ? !this.values.has(name) : force; if (next) this.values.add(name); else this.values.delete(name); return next; }
  contains(name) { return this.values.has(name); }
}

class FakeNode {
  constructor(tagName = "#fragment", nodeType = 1, value = "") { this.tagName = tagName; this.nodeType = nodeType; this.nodeValue = nodeType === 3 ? value : null; this.childNodes = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.classList = new FakeClassList(); this.listeners = {}; }
  set className(value) { this.classList = new FakeClassList(); this.classList.add(...String(value || "").split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.values].join(" "); }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  append(...children) { const additions = children.flatMap(child => child?.nodeType === 11 ? child.childNodes.splice(0) : [child]).filter(Boolean); additions.forEach(child => { child.parentNode = this; }); this.childNodes.push(...additions); }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  replaceWith(...children) { if (!this.parentNode) return; const parent = this.parentNode; const index = parent.childNodes.indexOf(this); const additions = children.flatMap(child => child?.nodeType === 11 ? child.childNodes.splice(0) : [child]).filter(Boolean); additions.forEach(child => { child.parentNode = parent; }); parent.childNodes.splice(index, 1, ...additions); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(child => child.textContent || child.nodeValue || "").join(""); }
  set textContent(value) { this.replaceChildren(new FakeNode("#text", 3, String(value))); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
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
    assert.equal(toPortableText(parseSource(renderedBodySource(container))), "如何《どう》");
    assert.equal(wrapper.dataset.glyphFailed, "true");
    const warning = wrapper.children.find(child => child.classList.contains("view-warning"));
    assert.ok(warning);
    assert.equal(warning.attributes["aria-hidden"], "true");
    assert.match(warning.title, /Asset/);
  } finally { restore(); }
});

test("missing Registry presentation remains visible with a copy-excluded warning marker", () => {
  const restore = installDocument();
  try {
    const container = new FakeNode("DIV");
    const source = "[本文:style=missing,font=missing-font]";
    renderLyrics(container, source, { mode: "viewer", registry: {} });
    const wrapper = container.childNodes[0];
    const warning = wrapper.children.find(child => child.classList.contains("view-warning"));
    assert.ok(warning);
    assert.equal(warning.attributes["aria-hidden"], "true");
    assert.match(warning.title, /Style missing/);
    assert.match(warning.title, /Font missing-font/);
    assert.equal(renderedBodySource(container), source);
  } finally { restore(); }
});

test("unloaded Registry Font keeps text readable with a copy-excluded warning marker", () => {
  const restore = installDocument();
  try {
    const container = new FakeNode("DIV");
    const source = "[本文:style=font-style]";
    renderLyrics(container, source, { mode: "viewer", loadedRegistryFonts: new Set(), registry: { styles: { "font-style": { font: "nishiki" } }, fonts: { nishiki: { type: "remote", url: "https://example.test/nishiki.woff2" } } } });
    const wrapper = container.childNodes[0];
    const warning = wrapper.children.find(child => child.classList.contains("view-warning"));
    assert.ok(warning);
    assert.match(warning.title, /Font nishiki/);
    assert.equal(renderedBodySource(container), source);
  } finally { restore(); }
});

test("Golden fixture survives Writer DOM rendering and Author Source projection", () => {
  const restore = installDocument();
  try {
    const container = new FakeNode("DIV");
    renderLyrics(container, goldenFixture, { mode: "writer", preserveSource: true, registry: { palettes: { "2": "#b52d2d", "3": "#236ca3" }, styles: { title: { color: 2 }, styled: { color: 3 } }, glyphs: { hare: { type: "text", text: "晴々" } } } });
    const projected = renderedBodySource(container);
    assert.deepEqual(parseSource(projected), parseSource(goldenFixture));
    assert.equal(toPortableText(parseSource(projected)), toPortableText(parseSource(goldenFixture)));
  } finally { restore(); }
});
