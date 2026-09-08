import { MAX_MANIFEST_JSON_BYTES, MAX_MANIFEST_JSON_CHARS, MAX_READER_DOCUMENT_JSON_BYTES, MAX_READER_DOCUMENT_JSON_CHARS, MAX_SOURCE_BYTES, MAX_SOURCE_CHARS } from "./config.js?v=20260908-016";
import { normalizeActiveVariantId } from "./document-model.js";

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
  try { return JSON.parse(text); } catch { throw new Error("JSON文書の形式が不正です。"); }
}

export function validateSourceText(text) {
  if (typeof text !== "string") throw new Error("本文が文字列ではありません。");
  const length = new TextEncoder().encode(text).byteLength;
  if (length > MAX_SOURCE_BYTES) throw new Error("本文が大きすぎます。");
  if (text.length > MAX_SOURCE_CHARS) throw new Error("本文が長すぎます。");
  return text;
}

/** '[' is valid Author Source, so local classification must not sniff JSON by first character. */
export function isReaderJsonFile(fileName = "", mimeType = "", text = "") {
  if (/\.txt$/i.test(String(fileName))) return false;
  if (/\.json$/i.test(String(fileName)) || /^(application\/json|application\/.*\+json)$/i.test(String(mimeType))) return true;
  if (!String(fileName) && !String(mimeType)) {
    try { JSON.parse(String(text)); return true; } catch { return false; }
  }
  return false;
}

async function loadManifestVariants(manifest, base) {
  const content = manifest.content || manifest.lyrics || {};
  if (Array.isArray(content.variants) && content.variants.length) {
    const variants = [];
    for (const [index, raw] of content.variants.entries()) {
      if (!raw || typeof raw !== "object") throw new Error("ManifestのVariant定義が不正です。");
      const id = String(raw.id || `variant-${String.fromCharCode(65 + index)}`);
      const source = typeof raw.text === "string" ? { text: validateSourceText(raw.text), url: "manifest:" } : await fetchText(raw.src || raw.url || raw.source, base);
      variants.push({ id, label: String(raw.label || raw.name || id), role: raw.role == null ? "" : String(raw.role), source });
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

export async function fetchText(resource, base) {
  const url = allowedUrl(resource, base);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`本文を取得できませんでした (${response.status})。配信元のCORS設定も確認してください。`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_SOURCE_BYTES) throw new Error("本文が大きすぎます。");
  const text = await response.text();
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
    const manifest = parseJsonText(await response.text());
    const variants = await loadManifestVariants(manifest, manifestUrl.href);
    return { manifest, variants, activeVariantId: normalizeActiveVariantId(variants, manifest.defaults?.variantId || manifest.activeVariantId), sourceUrl: manifestUrl.href };
  }
  if (sourceRef) {
    const source = await fetchText(sourceRef);
    const variants = [{ id: "variant-A", label: "Variant A", role: "", source }];
    return { manifest: { title: "外部本文", autoTitle: true, content: { format: "narou" } }, variants, activeVariantId: variants[0].id, sourceUrl: source.url };
  }
  const fallback = await fetchText("data/demo/reader.json");
  const manifestUrl = new URL("data/demo/reader.json", location.href);
  const manifest = parseJsonText(fallback.text);
  const variants = await loadManifestVariants(manifest, manifestUrl.href);
  return { manifest, variants, activeVariantId: normalizeActiveVariantId(variants, manifest.defaults?.variantId || manifest.activeVariantId), sourceUrl: manifestUrl.href };
}
