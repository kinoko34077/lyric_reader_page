// Syntax-independent document semantics. Legacy historical/modern fields are
// accepted only at the boundary and are normalized into this generic model.

export const DOCUMENT_MODEL_VERSION = 3;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function textSource(value, fallbackUrl = "") {
  if (typeof value === "string") return { text: value, url: fallbackUrl };
  if (!value || typeof value !== "object" || typeof value.text !== "string") return { text: "", url: fallbackUrl };
  return { text: value.text, url: String(value.url || fallbackUrl) };
}

function variantId(value, index) {
  const candidate = String(value?.id || "").trim();
  return candidate || `variant-${String.fromCharCode(65 + index)}`;
}

export function normalizeVariants(data = {}) {
  if (Array.isArray(data.variants) && data.variants.length) {
    const seen = new Set();
    return data.variants.map((raw, index) => {
      const id = variantId(raw, index);
      if (seen.has(id)) throw new Error(`Variant IDが重複しています: ${id}`);
      seen.add(id);
      const source = textSource(raw?.source ?? raw?.content ?? raw?.text, raw?.url || data.sourceUrl || "");
      return {
        id,
        label: String(raw?.label || raw?.name || id),
        role: raw?.role == null ? "" : String(raw.role),
        source,
        links: Array.isArray(raw?.links) ? clone(raw.links) : [],
        presentation: clone(raw?.presentation || {}),
        overrides: clone(raw?.overrides || {})
      };
    });
  }

  const variants = [];
  if (data.historical) variants.push({ id: "historical", label: "歴史的仮名遣", role: "historical", source: textSource(data.historical, data.sourceUrl), links: [], presentation: {}, overrides: {} });
  if (data.modern && data.modernAvailable) variants.push({ id: "modern", label: "現代仮名", role: "modern", source: textSource(data.modern, data.sourceUrl), links: [], presentation: {}, overrides: {} });
  if (!variants.length) variants.push({ id: "variant-A", label: "Variant A", role: "", source: textSource(data.source || data.text, data.sourceUrl), links: [], presentation: {}, overrides: {} });
  return variants;
}

export function normalizeActiveVariantId(variants, requested) {
  const ids = new Set((variants || []).map(variant => variant.id));
  return ids.has(requested) ? requested : variants?.[0]?.id || "variant-A";
}

export function activeVariant(data = {}, requested = data.activeVariantId) {
  const variants = normalizeVariants(data);
  return variants.find(variant => variant.id === normalizeActiveVariantId(variants, requested)) || variants[0];
}

export function replaceVariantSource(data, variantIdToUpdate, text) {
  const variants = normalizeVariants(data).map(variant => variant.id === variantIdToUpdate ? { ...variant, source: { ...variant.source, text: String(text) } } : variant);
  if (!variants.some(variant => variant.id === variantIdToUpdate)) throw new Error(`対象Variantがありません: ${variantIdToUpdate}`);
  return { ...data, variants };
}

export function resolveTitle({ source = "", explicitTitle = null, fallback = "無題" } = {}) {
  if (explicitTitle && typeof explicitTitle.text === "string" && explicitTitle.text.trim()) return explicitTitle.text.trim();
  const raw = String(source).replace(/^\uFEFF/, "");
  const line = raw.split(/\r?\n/, 1)[0].trim();
  return line || fallback;
}

/** Source metadata has precedence over derived JSON metadata. */
export function resolveMetadata(sourceMetadata = {}, jsonMetadata = {}) {
  const source = sourceMetadata && typeof sourceMetadata === "object" ? sourceMetadata : {};
  const json = jsonMetadata && typeof jsonMetadata === "object" ? jsonMetadata : {};
  const keys = new Set([...Object.keys(json), ...Object.keys(source)]);
  return Object.fromEntries([...keys].map(key => [key, source[key] == null || source[key] === "" ? json[key] : clone(source[key])]));
}

function linkMember(link, variantIdToFind) {
  return (link?.members || []).find(member => member?.variantId === variantIdToFind);
}

/**
 * Link membership is semantic: link IDs and member anchors are retained, while
 * character offsets are deliberately not used as identity.
 */
export function linkedPresentation(document = {}, variantIdToFind, linkId) {
  const link = (document.links || []).find(candidate => candidate?.id === linkId && linkMember(candidate, variantIdToFind));
  if (!link) return { presentation: {}, linked: false, override: false };
  const override = document.variantOverrides?.[variantIdToFind]?.[linkId];
  return { presentation: { ...clone(link.presentation || {}), ...clone(override || {}) }, linked: true, override: Boolean(override) };
}

export function setVariantOverride(document, variantIdToFind, linkId, presentation) {
  const variants = normalizeVariants(document);
  if (!variants.some(variant => variant.id === variantIdToFind)) throw new Error(`対象Variantがありません: ${variantIdToFind}`);
  const link = (document.links || []).find(candidate => candidate?.id === linkId && linkMember(candidate, variantIdToFind));
  if (!link) throw new Error(`対象Variant Linkがありません: ${linkId}`);
  return {
    ...document,
    variants,
    variantOverrides: {
      ...(clone(document.variantOverrides) || {}),
      [variantIdToFind]: { ...(clone(document.variantOverrides?.[variantIdToFind]) || {}), [linkId]: clone(presentation || {}) }
    }
  };
}

export function normalizeDocumentData(data = {}) {
  const variants = normalizeVariants(data);
  const activeVariantId = normalizeActiveVariantId(variants, data.activeVariantId || data.activeVariant);
  return {
    ...data,
    variants,
    activeVariantId,
    titleSource: data.titleSource || "first-line",
    links: Array.isArray(data.links) ? clone(data.links) : [],
    variantOverrides: clone(data.variantOverrides || {}) || {},
    metadata: resolveMetadata(data.sourceMetadata, data.metadata || data.manifest?.meta || {})
  };
}

export function migrateLegacyContent(content = {}) {
  const variants = normalizeVariants({
    variants: content.variants,
    source: typeof content.text === "string" ? { text: content.text, url: "reader:" } : (typeof content.content === "string" ? { text: content.content, url: "reader:" } : undefined),
    historical: typeof content.historical === "string" ? { text: content.historical, url: "reader:" } : content.historical,
    modern: typeof content.modern === "string" ? { text: content.modern, url: "reader:" } : content.modern,
    modernAvailable: content.modern != null
  });
  return { variants, activeVariantId: normalizeActiveVariantId(variants, content.activeVariantId || content.activeVariant), links: clone(content.links || []) || [], variantOverrides: clone(content.variantOverrides || {}) || {} };
}
