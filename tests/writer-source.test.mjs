import test from "node:test";
import assert from "node:assert/strict";
import { deleteSourceBackward, deleteSourceForward, normalizeSourceRange, replaceSourceRange, sourceLineBoundary } from "../assets/js/writer-source.js";

test("source range is clamped and ordered by grapheme boundary", () => {
  assert.deepEqual(normalizeSourceRange({ start: 99, end: -4 }, "A葛󠄀B"), { start: 0, end: 3 });
  assert.deepEqual(normalizeSourceRange({ start: 2, end: 1 }, "abc"), { start: 1, end: 2 });
});

test("source replacement never splits a grapheme cluster", () => {
  const source = "A👩‍👩‍👧‍👦B";
  assert.equal(replaceSourceRange(source, { start: 1, end: 2 }, "家族"), "A家族B");
});

test("source insertion preserves explicit Ruby syntax as plain Source", () => {
  const source = "前後";
  assert.equal(replaceSourceRange(source, { start: 1, end: 1 }, "｜3ペウコ《ピョコ》"), "前｜3ペウコ《ピョコ》後");
});

test("backward and forward deletion use the same Source range primitive", () => {
  assert.equal(deleteSourceBackward("ABCD", 3), "ABD");
  assert.equal(deleteSourceForward("ABCD", 1), "ACD");
  assert.equal(deleteSourceBackward("A", 0), "A");
  assert.equal(deleteSourceForward("A", 1), "A");
});

test("first-line boundary exposes a single logical Title and Body range", () => {
  assert.deepEqual(sourceLineBoundary("題\n本文"), { titleStart: 0, titleEnd: 1, bodyStart: 2 });
  assert.deepEqual(sourceLineBoundary("題\r\n本文"), { titleStart: 0, titleEnd: 1, bodyStart: 2 });
  assert.deepEqual(sourceLineBoundary("題"), { titleStart: 0, titleEnd: 1, bodyStart: 1 });
});
