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
    return { ok: false, source, error: error instanceof Error ? error : new Error("Sourceを解析できませんでした") };
  }
}
