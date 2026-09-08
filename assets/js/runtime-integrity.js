/** Runtime boundary helpers shared by the Reader shell and document pipeline. */

function finiteNonNegative(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

function ratio(value, total, viewport) {
  const range = Math.max(0, finiteNonNegative(total) - finiteNonNegative(viewport));
  return range ? Math.min(1, Math.max(0, finiteNonNegative(value) / range)) : 0;
}

export function captureScrollPosition(metrics = {}) {
  return {
    top: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    left: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
    anchor: Number.isFinite(Number(metrics.anchor)) ? Number(metrics.anchor) : null
  };
}

export function restoreScrollPosition(position = {}, metrics = {}) {
  const topRange = Math.max(0, finiteNonNegative(metrics.scrollHeight) - finiteNonNegative(metrics.clientHeight));
  const leftRange = Math.max(0, finiteNonNegative(metrics.scrollWidth) - finiteNonNegative(metrics.clientWidth));
  return {
    top: Math.min(1, Math.max(0, Number(position.top) || 0)) * topRange,
    left: Math.min(1, Math.max(0, Number(position.left) || 0)) * leftRange,
    anchor: Number.isFinite(Number(position.anchor)) ? Number(position.anchor) : null
  };
}

export function scrollStorageKey(identity) {
  return `lyric-reader:scroll:${String(identity || "default")}`;
}

/** Validate a candidate before replacing the current document. */
export function commitDocumentCandidate(current, candidate, validate) {
  try {
    const value = validate(candidate);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, value: current, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function normalizeRubyRange(range, length) {
  const nodeIndex = Number(range?.nodeIndex);
  const max = Math.max(0, Math.floor(Number(length) || 0));
  if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || max < 1) return null;
  const part = range?.part === "base" ? "base" : range?.part === "ruby" ? "ruby" : null;
  if (!part) return null;
  const first = Math.max(0, Math.min(max, Number(range?.start) || 0));
  const second = Math.max(0, Math.min(max, Number(range?.end) || 0));
  const start = Math.min(first, second); const end = Math.max(first, second);
  return end > start ? { nodeIndex, part, start, end } : null;
}
