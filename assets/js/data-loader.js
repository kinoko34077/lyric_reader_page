import { MAX_SOURCE_BYTES, MAX_SOURCE_CHARS } from "./config.js?v=20260908-013";

const allowedUrl = (value, base = location.href) => {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP(S) URLのみ参照できます。");
  return url;
};

export function parseJsonText(text) {
  if (typeof text !== "string") throw new Error("JSON本文が文字列ではありません。");
  if (text.length > MAX_SOURCE_CHARS || new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES) throw new Error("JSON文書が大きすぎます。");
  try { return JSON.parse(text); } catch { throw new Error("JSON文書の形式が不正です。"); }
}

/** '[' is valid Author Source, so local classification must not sniff JSON by first character. */
export function isReaderJsonFile(fileName = "", mimeType = "") {
  return /\.json$/i.test(String(fileName)) || /^(application\/json|application\/.*\+json)$/i.test(String(mimeType));
}

export async function fetchText(resource, base) {
  const url = allowedUrl(resource, base);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`本文を取得できませんでした (${response.status})。配信元のCORS設定も確認してください。`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_SOURCE_BYTES) throw new Error("本文が大きすぎます。");
  const text = await response.text();
  if (text.length > MAX_SOURCE_CHARS) throw new Error("本文が長すぎます。");
  return { text, url: url.href };
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
    const source = manifest.content?.["historical"] || manifest.content?.src || manifest.lyrics?.historical;
    if (!source) throw new Error("Manifestに本文URLがありません。");
    const historical = await fetchText(source, manifestUrl.href);
    let modern = historical;
    const modernRef = manifest.content?.modern || manifest.lyrics?.modern;
    if (modernRef) modern = await fetchText(modernRef, manifestUrl.href);
    return { manifest, historical, modern, modernAvailable: Boolean(modernRef), sourceUrl: manifestUrl.href };
  }
  if (sourceRef) {
    const source = await fetchText(sourceRef);
    return { manifest: { title: "外部本文", autoTitle: true, content: { format: "narou" } }, historical: source, modern: source, modernAvailable: false, sourceUrl: source.url };
  }
  const fallback = await fetchText("data/demo/reader.json");
  const manifestUrl = new URL("data/demo/reader.json", location.href);
  const manifest = parseJsonText(fallback.text);
  const historical = await fetchText(manifest.content.historical, manifestUrl.href);
  const modern = manifest.content.modern ? await fetchText(manifest.content.modern, manifestUrl.href) : historical;
  return { manifest, historical, modern, modernAvailable: Boolean(manifest.content.modern), sourceUrl: manifestUrl.href };
}
