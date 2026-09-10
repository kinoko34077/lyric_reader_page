/** JSON-safe identity and draft primitives shared by the Writer state boundary. */
import { DOCUMENT_MODEL_VERSION, migrateLegacyContent, normalizeActiveVariantId, normalizeDocumentData, normalizeVariants } from "./document-model.js";
const READER_DOCUMENT_FIELDS = new Set(["version", "content", "meta", "sourceMetadata", "theme", "defaults", "registry", "links", "warnings", "format", "title", "text", "source", "historical", "modern", "modernAvailable", "lyrics"]);
const NON_PERSISTED_LEGACY_FIELDS = new Set(["annotations"]);
const RESERVED_EXTENSION_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export function documentIdentity(data = {}) {
  const manifestId = data.manifest?.id || data.manifest?.meta?.id || "";
  return [manifestId, data.sourceIdentity || "", data.sourceUrl || "", data.sourceName || ""].join("|");
}

export const MAX_HISTORY_ENTRIES = 40;
export const MAX_HISTORY_BYTES = 8_000_000;

export function localSourceIdentity(name, size, lastModified, hash = "") {
  return `local:${String(name || "本文")}:${Number(size) || 0}:${Number(lastModified) || 0}:${String(hash || "unknown")}`;
}

export function draftStorageKey(identity, tabId = "default") {
  return `lyric-reader:draft:${String(identity || "default")}:tab:${String(tabId || "default")}`;
}

export function boundedHistory(history, index, next, limits = {}) {
  const maxEntries = limits.maxEntries || MAX_HISTORY_ENTRIES;
  const maxBytes = limits.maxBytes || MAX_HISTORY_BYTES;
  let items = [...(history || []).slice(0, (index ?? history?.length - 1) + 1), next];
  const bytes = value => { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } };
  if (bytes(next) > maxBytes) return { history: [next], index: 0 };
  while (items.length > maxEntries || bytes(items) > maxBytes) items.shift();
  return { history: items, index: items.length - 1 };
}

export function clone(value) {
  return value == null ? value : structuredClone(value);
}

/** Deterministic lightweight document fingerprint for Draft base-revision checks. */
export function documentFingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value ?? null));
  let hash = 2166136261;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Keep unknown JSON fields inert so canonical save does not erase readable extensions. */
export function readerDocumentExtensions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !READER_DOCUMENT_FIELDS.has(key) && !NON_PERSISTED_LEGACY_FIELDS.has(key) && !RESERVED_EXTENSION_KEYS.has(key)).map(([key, field]) => [key, clone(field)]));
}

function withoutLegacyAnnotations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { annotations: _annotations, ...current } = value;
  return current;
}

export function documentPayload(data, title, activeVariant = null) {
  const normalized = normalizeDocumentData(data);
  const activeVariantId = normalizeActiveVariantId(normalized.variants, activeVariant || normalized.activeVariantId);
  return {
    version: DOCUMENT_MODEL_VERSION,
    activeVariantId,
    title: String(title || "無題"),
    variants: clone(normalized.variants),
    links: clone(normalized.links),
    variantOverrides: clone(normalized.variantOverrides),
    metadata: clone(normalized.metadata),
    sourceMetadata: clone(data?.sourceMetadata || {}),
    sourceUrl: String(data?.sourceUrl || ""),
    sourceName: String(data?.sourceName || ""),
    sourceIdentity: String(data?.sourceIdentity || ""),
    titleSource: data?.titleSource || "first-line",
    manifest: clone(data?.manifest || {}),
    documentExtensions: clone(data?.documentExtensions || {}) || {}
  };
}

export function draftPayload(data, title, activeVariant, options = {}) {
  const document = documentPayload(data, title, activeVariant);
  const savedAt = Number.isFinite(Number(options.savedAt)) ? Number(options.savedAt) : Date.now();
  return {
    version: DOCUMENT_MODEL_VERSION,
    schemaVersion: DOCUMENT_MODEL_VERSION,
    document,
    baseDocumentHash: String(options.baseDocumentHash || documentFingerprint(document)),
    sourceIdentity: document.sourceIdentity,
    dirtyAtSave: options.dirtyAtSave ?? true,
    savedAt
  };
}

export function normalizeDraft(value) {
  if (!value || typeof value !== "object") return null;
  const schemaVersion = value.schemaVersion == null && value.version != null ? Number(value.version) : value.schemaVersion == null ? null : Number(value.schemaVersion);
  if (schemaVersion != null && (!Number.isInteger(schemaVersion) || schemaVersion > DOCUMENT_MODEL_VERSION)) return null;
  if (value.version === DOCUMENT_MODEL_VERSION && Array.isArray(value.document?.variants)) {
    const document = withoutLegacyAnnotations(value.document);
    return { ...value, schemaVersion: DOCUMENT_MODEL_VERSION, document, baseDocumentHash: typeof value.baseDocumentHash === "string" ? value.baseDocumentHash : "", sourceIdentity: String(value.sourceIdentity ?? document.sourceIdentity ?? ""), dirtyAtSave: value.dirtyAtSave ?? true, savedAt: Number(value.savedAt) || 0 };
  }
  if (value.document && (value.version === 1 || value.version === 2)) {
    const legacy = value.document;
    const migrated = migrateLegacyContent(legacy);
    const document = withoutLegacyAnnotations({ ...legacy, ...migrated, version: DOCUMENT_MODEL_VERSION, titleSource: legacy.titleSource || "first-line" });
    return { ...value, version: DOCUMENT_MODEL_VERSION, schemaVersion: DOCUMENT_MODEL_VERSION, document, baseDocumentHash: typeof value.baseDocumentHash === "string" ? value.baseDocumentHash : "", sourceIdentity: String(value.sourceIdentity ?? document.sourceIdentity ?? ""), dirtyAtSave: value.dirtyAtSave ?? true, savedAt: Number(value.savedAt) || 0 };
  }
  if (typeof value.raw !== "string") return null;
  const migrated = migrateLegacyContent({ historical: { text: value.raw, url: "draft:" } });
  const document = {
    version: DOCUMENT_MODEL_VERSION, activeVariantId: migrated.activeVariantId, title: String(value.title || "無題"), ...migrated,
    titleSource: "first-line", manifest: { registry: clone(value.registry || {}) }
  };
  return {
    version: DOCUMENT_MODEL_VERSION,
    schemaVersion: DOCUMENT_MODEL_VERSION,
    document,
    baseDocumentHash: typeof value.baseDocumentHash === "string" ? value.baseDocumentHash : "",
    sourceIdentity: String(value.sourceIdentity ?? ""),
    dirtyAtSave: value.dirtyAtSave ?? true,
    savedAt: Number(value.savedAt) || 0
  };
}

export function draftDiffers(draft, current) {
  return JSON.stringify(normalizeDraft(draft)?.document || null) !== JSON.stringify(current || null);
}

export function migrateReaderDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reader文書の形式が不正です。");
  const current = withoutLegacyAnnotations(value);
  const version = current.version == null ? 1 : Number(current.version);
  if (!Number.isInteger(version) || version < 1) throw new Error("未対応のReader文書versionです。");
  if (version === DOCUMENT_MODEL_VERSION && Array.isArray(current.content?.variants)) return { ...current, version: DOCUMENT_MODEL_VERSION };
  const content = typeof current.content === "object" && current.content ? current.content : current;
  const migrated = migrateLegacyContent(content);
  const warnings = Array.isArray(current.warnings) ? [...current.warnings] : [];
  if (version > DOCUMENT_MODEL_VERSION && !warnings.includes("unknown-version")) warnings.push("unknown-version");
  const result = { ...current, version: DOCUMENT_MODEL_VERSION, content: { ...content, ...migrated, format: content.format || current.format || "narou-text" } };
  if (warnings.length) result.warnings = warnings;
  return result;
}
