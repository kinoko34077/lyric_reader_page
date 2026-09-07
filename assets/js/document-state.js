/** JSON-safe identity and draft primitives shared by the Writer state boundary. */
export function documentIdentity(data = {}) {
  const manifestId = data.manifest?.id || data.manifest?.meta?.id || "";
  return [manifestId, data.sourceUrl || "", data.sourceName || ""].join("|");
}

export function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function documentPayload(data, title, annotations = [], activeVariant = "historical") {
  return {
    activeVariant,
    title: String(title || "無題"),
    historical: clone(data?.historical || { text: "" }),
    modern: clone(data?.modern || { text: "" }),
    modernAvailable: Boolean(data?.modernAvailable),
    titleSource: data?.titleSource || "meta",
    manifest: clone(data?.manifest || {}),
    annotations: clone(annotations) || []
  };
}

export function draftPayload(data, title, annotations, activeVariant) {
  return { version: 2, document: documentPayload(data, title, annotations, activeVariant), savedAt: Date.now() };
}

export function normalizeDraft(value) {
  if (!value || typeof value !== "object") return null;
  if (value.version === 2 && value.document?.historical) return value;
  if (typeof value.raw !== "string") return null;
  const historical = { text: value.raw, url: "draft:" };
  return {
    version: 2,
    document: {
      activeVariant: "historical", title: String(value.title || "無題"), historical, modern: historical,
      modernAvailable: false, titleSource: "meta", manifest: { registry: clone(value.registry || {}) },
      annotations: clone(value.annotations || [])
    },
    savedAt: value.savedAt || 0
  };
}

export function draftDiffers(draft, current) {
  return JSON.stringify(normalizeDraft(draft)?.document || null) !== JSON.stringify(current || null);
}

export function migrateReaderDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reader文書の形式が不正です。");
  const version = value.version == null ? 1 : Number(value.version);
  if (!Number.isInteger(version) || version < 1 || version > 2) throw new Error("未対応のReader文書versionです。");
  return { ...value, version: 2 };
}
