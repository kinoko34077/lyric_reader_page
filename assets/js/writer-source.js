import { graphemes } from "./syntax-adapter.js";

function sourceUnits(source) {
  return graphemes(String(source ?? ""));
}

function sourceLength(sourceOrLength) {
  return typeof sourceOrLength === "number" ? Math.max(0, Math.trunc(sourceOrLength)) : sourceUnits(sourceOrLength).length;
}

/** Normalize a semantic Source range to ordered grapheme boundaries. */
export function normalizeSourceRange(range, sourceOrLength) {
  const length = sourceLength(sourceOrLength);
  const rawStart = Number.isFinite(Number(range?.start)) ? Math.trunc(Number(range.start)) : 0;
  const rawEnd = Number.isFinite(Number(range?.end)) ? Math.trunc(Number(range.end)) : rawStart;
  const start = Math.max(0, Math.min(length, Math.min(rawStart, rawEnd)));
  const end = Math.max(start, Math.min(length, Math.max(rawStart, rawEnd)));
  return { start, end };
}

/** Replace a semantic Source range without splitting a grapheme cluster. */
export function replaceSourceRange(source, range, insertedText = "") {
  const units = sourceUnits(source);
  const normalized = normalizeSourceRange(range, units.length);
  const replacement = String(insertedText ?? "").replace(/\r\n?/g, "\n");
  return [...units.slice(0, normalized.start), replacement, ...units.slice(normalized.end)].join("");
}

export function deleteSourceBackward(source, caret) {
  const normalized = normalizeSourceRange({ start: caret, end: caret }, source);
  if (normalized.start === 0) return String(source ?? "");
  return replaceSourceRange(source, { start: normalized.start - 1, end: normalized.start }, "");
}

export function deleteSourceForward(source, caret) {
  const normalized = normalizeSourceRange({ start: caret, end: caret }, source);
  const length = sourceLength(source);
  if (normalized.start >= length) return String(source ?? "");
  return replaceSourceRange(source, { start: normalized.start, end: normalized.start + 1 }, "");
}

/** Return the logical Source ranges for the first line and the body. */
export function sourceLineBoundary(source) {
  const units = sourceUnits(source);
  const titleStart = units[0] === "\uFEFF" ? 1 : 0;
  const newline = units.findIndex((unit, index) => index >= titleStart && (unit === "\n" || unit === "\r\n"));
  if (newline < 0) return { titleStart, titleEnd: units.length, bodyStart: units.length };
  return { titleStart, titleEnd: newline, bodyStart: newline + 1 };
}
