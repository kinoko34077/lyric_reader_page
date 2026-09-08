import test from "node:test";
import assert from "node:assert/strict";
import { serializeEditedNode } from "../assets/js/editor-source.js";
import { legacyNarouTextAdapter, parseSource, toPlainText } from "../assets/js/syntax-adapter.js";

const text = value => ({ nodeType: 3, nodeValue: value });
const element = (tagName, classNames, dataset, children = [], textContent = children.map(child => child.textContent || child.nodeValue || "").join("")) => ({
  nodeType: 1, tagName, classList: { contains: name => classNames.includes(name) }, dataset: dataset || {}, childNodes: children,
  textContent, querySelector: () => null
});

test("glyph fallback serializes the original source wrapper", () => {
  const glyph = element("SPAN", ["source-presentation", "has-glyph"], { glyph: "hare", glyphFallback: "晴", sourceRaw: "[晴:glyph=hare]" }, [], "晴");
  assert.equal(serializeEditedNode(glyph), "[晴:glyph=hare]");
});

test("unchanged Ruby markup is preserved when the rendered editor tree is serialized", () => {
  const base = element("SPAN", [], {}, [text("如何")], "如何");
  const rt = element("RT", [], {}, [text("どう")], "どう");
  const ruby = { nodeType: 1, tagName: "RUBY", childNodes: [base, rt], querySelector: selector => selector === "rt" ? rt : null };
  const sourceRuby = element("SPAN", ["source-ruby"], { sourceBase: "如何", sourceRuby: "どう", sourceRaw: "[如何《どう》:base-range=0-1,base-c=2]" }, [ruby], "如何どう");
  sourceRuby.querySelector = selector => selector === "ruby" ? ruby : null;
  assert.equal(serializeEditedNode(sourceRuby), sourceRuby.dataset.sourceRaw);
});

test("Ruby source stays parseable when nested inside a presentation target", () => {
  const base = element("SPAN", [], {}, [text("a:b")], "a:b");
  const rt = element("RT", [], {}, [text("c:d")], "c:d");
  const ruby = { nodeType: 1, tagName: "RUBY", childNodes: [base, rt], querySelector: selector => selector === "rt" ? rt : null };
  const sourceRuby = element("SPAN", ["source-ruby"], { sourceBase: "a:b", sourceRuby: "c:d", sourceRaw: "｜a:b《c:d》", sourceExplicit: "true" }, [ruby], "a:bc:d");
  sourceRuby.querySelector = selector => selector === "ruby" ? ruby : null;
  const outer = element("SPAN", ["source-presentation"], { style: "outer" }, [sourceRuby]);
  assert.equal(serializeEditedNode(outer), "[｜a\\:b《c\\:d》:style=outer]");
  assert.deepEqual(parseSource(serializeEditedNode(outer)).nodes[0].children[0], parseSource("｜a:b《c:d》").nodes[0]);
});

test("ordinary editor text serializes edited text, not rendered metadata", () => {
  assert.equal(serializeEditedNode(element("SPAN", ["source-text"], {}, [text("追加")], "追加")), "追加");
});

test("editor serialization follows the selected Adapter surface format", () => {
  const presentation = element("SPAN", ["source-presentation"], { style: "legacy-style" }, [element("SPAN", ["source-text"], {}, [text("本文")], "本文")]);
  assert.equal(serializeEditedNode(presentation, false, "narou-legacy"), "[本文]{style=legacy-style}");
  assert.equal(serializeEditedNode(presentation, false, "narou-text"), "[本文:style=legacy-style]");
  assert.deepEqual(parseSource(serializeEditedNode(presentation, false, "narou-legacy"), legacyNarouTextAdapter).nodes, parseSource("[本文:style=legacy-style]").nodes);
});

test("edited Ruby text retains the presentation ranges represented by its markers", () => {
  const marker = element("SPAN", ["ruby-presentation-part"], { rubyPart: "base", rubyStart: "0", rubyEnd: "1", palette: "2" }, [text("彼")], "彼");
  const base = element("SPAN", [], {}, [marker], "彼何");
  const rt = element("RT", [], {}, [text("どう")], "どう");
  const ruby = { nodeType: 1, tagName: "RUBY", childNodes: [base, rt], querySelector: selector => selector === "rt" ? rt : null };
  const sourceRuby = element("SPAN", ["source-ruby"], { sourceBase: "如何", sourceRuby: "どう", sourceExplicit: "false" }, [ruby], "彼何どう");
  sourceRuby.querySelector = selector => selector === "ruby" ? ruby : null;
  sourceRuby.querySelectorAll = selector => selector.includes('data-ruby-part="base"') ? [marker] : [];
  const serialized = serializeEditedNode(sourceRuby);
  assert.equal(serialized, "[彼何《どう》:base-range=0-1,base-c=2]");
  assert.deepEqual(parseSource(serialized).nodes[0].baseDecorations[0].presentation, { color: { type: "palette", index: 2 } });
});

test("editor text escapes vNext delimiters so reparse remains lossless", () => {
  const serialized = serializeEditedNode(element("SPAN", ["source-text"], {}, [text("[追加]:\\")], "[追加]:\\"));
  assert.equal(serialized, "\\[追加\\]:\\\\");
  assert.equal(toPlainText(parseSource(serialized)), "[追加]:\\");
});
