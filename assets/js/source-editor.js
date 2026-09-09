export function sourceErrorLocation(source, error) {
  const value = String(source ?? "");
  const candidate = Number(error?.sourceIndex);
  const offset = Number.isFinite(candidate) ? Math.max(0, Math.min(value.length, Math.floor(candidate))) : 0;
  const lineStart = value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return { offset, line: value.slice(0, offset).split("\n").length, column: offset - lineStart + 1 };
}

function locatedError(source, error) {
  const cause = error instanceof Error ? error : new Error("Sourceを解析できませんでした");
  const location = sourceErrorLocation(source, cause);
  const result = new Error(`${cause.message}（行${location.line}・列${location.column}）`);
  result.name = cause.name;
  result.sourceIndex = location.offset;
  result.sourceLocation = location;
  return result;
}

/**
 * Validate an Author Source edit without mutating the current document.
 * The caller decides when a successful result becomes the active Variant source.
 */
export function parseSourceEditorInput(value, adapter) {
  const source = String(value ?? "");
  try {
    const document = adapter.parse(source);
    return { ok: true, source, document };
  } catch (error) {
    return { ok: false, source, error: locatedError(source, error) };
  }
}
