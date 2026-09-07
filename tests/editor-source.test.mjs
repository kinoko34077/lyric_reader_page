import test from "node:test";
import assert from "node:assert/strict";
import { serializeEditedNode } from "../assets/js/editor-source.js";

const text = value => ({ nodeType: 3, nodeValue: value });
const element = (tagName, classNames, dataset, children = [], textContent = children.map(child => child.textContent || child.nodeValue || "").join("")) => ({
  nodeType: 1, tagName, classList: { contains: name => classNames.includes(name) }, dataset: dataset || {}, childNodes: children,
  textContent, querySelector: () => null
});

test("glyph fallback serializes the original source wrapper", () => {
  const glyph = element("SPAN", ["source-presentation", "has-glyph"], { glyph: "hare", glyphFallback: "晴", sourceRaw: "[晴]{glyph=hare}" }, [], "晴");
  assert.equal(serializeEditedNode(glyph), "[晴]{glyph=hare}");
});

test("ordinary editor text serializes edited text, not rendered metadata", () => {
  assert.equal(serializeEditedNode(element("SPAN", ["source-text"], {}, [text("追加")], "追加")), "追加");
});
