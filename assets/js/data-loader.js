import { MAX_MANIFEST_JSON_BYTES, MAX_MANIFEST_JSON_CHARS, MAX_READER_DOCUMENT_JSON_BYTES, MAX_READER_DOCUMENT_JSON_CHARS, MAX_SOURCE_BYTES, MAX_SOURCE_CHARS } from "./config.js";
import { normalizeActiveVariantId } from "./document-model.js";
import { containerToReaderDocument, isLyricContainerText, parseLyricContainer } from "./lyric-container.js";

const allowedUrl = (value, base = location.href) => {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP(S) URLのみ参照できます。");
  return url;
};

export function parseJsonText(text, kind = "manifest") {
  if (typeof text !== "string") throw new Error("JSON本文が文字列ではありません。");
  const documentKind = kind === "reader-document";
  const maxChars = documentKind ? MAX_READER_DOCUMENT_JSON_CHARS : MAX_MANIFEST_JSON_CHARS;
  const maxBytes = documentKind ? MAX_READER_DOCUMENT_JSON_BYTES : MAX_MANIFEST_JSON_BYTES;
  if (text.length > maxChars || new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("JSON文書が大きすぎます。");
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("JSON文書の形式が不正です。"); }
}

export function validateSourceText(text) {
  if (typeof text !== "string") throw new Error("本文が文字列ではありません。");
  const length = new TextEncoder().encode(text).byteLength;
  if (length > MAX_SOURCE_BYTES) throw new Error("本文が大きすぎます。");
  if (text.length > MAX_SOURCE_CHARS) throw new Error("本文が長すぎます。");
  return text;
}

async function readResponseText(response, maxBytes, tooLargeMessage) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value || []);
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error(tooLargeMessage);
        chunks.push(chunk);
      }
    } catch (error) {
      try { await reader.cancel?.(); } catch { /* the original read error is authoritative */ }
      throw error;
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  return response.text();
}

/** '[' is valid Author Source, so local classification must not sniff JSON by first character. */
export function isReaderJsonFile(fileName = "", mimeType = "", text = "") {
  if (/\.txt$/i.test(String(fileName))) return false;
  if (/\.json$/i.test(String(fileName)) || /^(application\/json|application\/.*\+json)$/i.test(String(mimeType))) return true;
  if (!String(fileName) && !String(mimeType)) {
    try { JSON.parse(String(text).replace(/^\uFEFF/, "")); return true; } catch { return false; }
  }
  return false;
}

export function parseLocalInput(text, fileName = "", mimeType = "") {
  const value = String(text);
  const isContainer = /\.lyric\.txt$/i.test(String(fileName)) || isLyricContainerText(value);
  if (isContainer) {
    const container = parseLyricContainer(value);
    validateSourceText(container.source);
    return { kind: "reader-document", document: containerToReaderDocument(container), warnings: container.warnings || [] };
  }
  if (isReaderJsonFile(fileName, mimeType, value)) return { kind: "reader-document", document: parseJsonText(value, "reader-document"), warnings: [] };
  return { kind: "source", source: validateSourceText(value), warnings: [] };
}

async function loadManifestVariants(manifest, base) {
  const content = manifest.content || manifest.lyrics || {};
  if (Array.isArray(content.variants) && content.variants.length) {
    const variants = [];
    const seen = new Set();
    for (const [index, raw] of content.variants.entries()) {
      if (!raw || typeof raw !== "object") throw new Error("ManifestのVariant定義が不正です。");
      const id = String(raw.id || `variant-${String.fromCharCode(65 + index)}`);
      if (!id || seen.has(id)) throw new Error(`ManifestのVariant IDが重複しています: ${id}`);
      seen.add(id);
      const inline = typeof raw.text === "string" ? raw.text : raw.source && typeof raw.source === "object" && typeof raw.source.text === "string" ? raw.source.text : null;
      const source = inline !== null ? { text: validateSourceText(inline), url: "manifest:" } : await fetchText(raw.src || raw.url || (typeof raw.source === "string" ? raw.source : ""), base);
      variants.push({ id, label: String(raw.label || raw.name || id), role: raw.role == null ? "" : String(raw.role), source, links: Array.isArray(raw.links) ? raw.links : [], presentation: raw.presentation && typeof raw.presentation === "object" ? raw.presentation : {}, overrides: raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {} });
    }
    return variants;
  }
  const firstRef = content.historical || content.src;
  if (!firstRef) throw new Error("Manifestに本文URLがありません。");
  const first = await fetchText(firstRef, base);
  const variants = [{ id: "historical", label: "歴史的仮名遣", role: "historical", source: first }];
  if (content.modern) variants.push({ id: "modern", label: "現代仮名", role: "modern", source: await fetchText(content.modern, base) });
  return variants;
}

function manifestDocumentFields(manifest, variants, activeVariantId) {
  const content = manifest.content || manifest.lyrics || {};
  const manifestMetadata = manifest.sourceMetadata && typeof manifest.sourceMetadata === "object" && !Array.isArray(manifest.sourceMetadata) ? manifest.sourceMetadata : null;
  const contentMetadata = content.sourceMetadata && typeof content.sourceMetadata === "object" && !Array.isArray(content.sourceMetadata) ? content.sourceMetadata : null;
  return {
    manifest,
    variants,
    activeVariantId,
    links: Array.isArray(content.links) ? content.links : [],
    variantOverrides: content.variantOverrides && typeof content.variantOverrides === "object" ? content.variantOverrides : {},
    titleSource: content.titleSource || manifest.titleSource || "first-line",
    sourceMetadata: manifestMetadata && Object.keys(manifestMetadata).length ? manifestMetadata : (contentMetadata || manifestMetadata || {})
  };
}

export async function fetchText(resource, base) {
  const url = allowedUrl(resource, base);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`本文を取得できませんでした (${response.status})。配信元のCORS設定も確認してください。`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_SOURCE_BYTES) throw new Error("本文が大きすぎます。");
  const text = await readResponseText(response, MAX_SOURCE_BYTES, "本文が大きすぎます。");
  return { text: validateSourceText(text), url: url.href };
}

export async function loadInput(hash = location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const manifestRef = params.get("m") || params.get("manifest");
  const sourceRef = params.get("src");
  if (manifestRef) {
    const manifestUrl = allowedUrl(manifestRef);
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifestを取得できませんでした (${response.status})。`);
    const manifest = parseJsonText(await readResponseText(response, MAX_MANIFEST_JSON_BYTES, "JSON文書が大きすぎます。"));
    const variants = await loadManifestVariants(manifest, manifestUrl.href);
    return { ...manifestDocumentFields(manifest, variants, normalizeActiveVariantId(variants, manifest.defaults?.variantId || manifest.activeVariantId)), sourceUrl: manifestUrl.href };
  }
  if (sourceRef) {
    const source = await fetchText(sourceRef);
    const variants = [{ id: "variant-A", label: "Variant A", role: "", source }];
    return { manifest: { title: "外部本文", autoTitle: true, content: { format: "narou-text" } }, variants, activeVariantId: variants[0].id, links: [], variantOverrides: {}, titleSource: "first-line", sourceMetadata: {}, sourceUrl: source.url };
  }
  const fallback = await fetchText("data/demo/reader.json");
  const manifestUrl = new URL("data/demo/reader.json", location.href);
  const manifest = parseJsonText(fallback.text);
  const variants = await loadManifestVariants(manifest, manifestUrl.href);
  return { ...manifestDocumentFields(manifest, variants, normalizeActiveVariantId(variants, manifest.defaults?.variantId || manifest.activeVariantId)), sourceUrl: manifestUrl.href };
}
