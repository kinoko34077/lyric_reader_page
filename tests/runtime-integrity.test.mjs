import test from "node:test";
import assert from "node:assert/strict";
import { captureScrollPosition, commitDocumentCandidate, mergeAnnotations, normalizeRubyRange, restoreScrollPosition, scrollStorageKey } from "../assets/js/runtime-integrity.js";

test("reader-shell scroll position is stored as bounded ratios and restored", () => {
  const position = captureScrollPosition({ scrollTop: 240, scrollLeft: 90, scrollHeight: 1240, scrollWidth: 690, clientHeight: 400, clientWidth: 390, anchor: 18 });
  assert.deepEqual(position, { top: 0.2857142857142857, left: 0.3, anchor: 18 });
  const restored = restoreScrollPosition(position, { scrollHeight: 2240, scrollWidth: 1090, clientHeight: 640, clientWidth: 490 });
  assert.equal(restored.anchor, 18); assert.ok(Math.abs(restored.top - 457.14285714285717) < 1e-9); assert.equal(restored.left, 180);
  assert.deepEqual(captureScrollPosition({ scrollTop: 9, scrollLeft: 3, scrollHeight: 100, scrollWidth: 100, clientHeight: 200, clientWidth: 200 }), { top: 0, left: 0, anchor: null });
});

test("scroll storage key is isolated by document identity", () => {
  assert.equal(scrollStorageKey("local:lyrics:10:1:a"), "lyric-reader:scroll:local:lyrics:10:1:a");
});

test("invalid document candidates roll back without mutating current state", () => {
  const current = { title: "current", variants: [{ id: "a", source: { text: "安全" } }] };
  const result = commitDocumentCandidate(current, { title: "broken", variants: [] }, candidate => {
    if (!candidate.variants.length) throw new Error("本文がありません");
    return structuredClone(candidate);
  });
  assert.equal(result.ok, false);
  assert.equal(result.value, current);
  assert.equal(result.error.message, "本文がありません");
  assert.equal(current.title, "current");
});

test("range annotations are clamped, sorted, and deduplicated before rendering", () => {
  const annotations = mergeAnnotations([
    { range: { start: 8, end: 3 }, style: { color: "red" } },
    { range: { start: 0, end: 2 }, style: { color: "blue" } },
    { range: { start: 0, end: 2 }, style: { color: "blue" } },
    { range: { start: 2, end: 3 }, style: { color: "red" } },
    { range: { start: 4, end: 4 }, style: { color: "ignored" } }
  ], [{ range: { start: 1, end: 2 }, style: { color: "green" } }]);
  assert.deepEqual(annotations, [
    { range: { start: 0, end: 2 }, style: { color: "blue" } },
    { range: { start: 1, end: 2 }, style: { color: "green" } },
    { range: { start: 2, end: 8 }, style: { color: "red" } }
  ]);
});

test("Ruby selection is clamped to its own grapheme domain", () => {
  assert.deepEqual(normalizeRubyRange({ nodeIndex: 2, part: "base", start: -2, end: 99 }, 4), { nodeIndex: 2, part: "base", start: 0, end: 4 });
  assert.deepEqual(normalizeRubyRange({ nodeIndex: 1, part: "ruby", start: 3, end: 1 }, 4), { nodeIndex: 1, part: "ruby", start: 1, end: 3 });
  assert.equal(normalizeRubyRange({ nodeIndex: -1, part: "ruby", start: 0, end: 1 }, 4), null);
  assert.equal(normalizeRubyRange({ nodeIndex: 1, part: "ruby", start: 2, end: 2 }, 4), null);
});
