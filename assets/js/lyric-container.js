const MAGIC = /^LYRIC-READER\/(\d+)$/;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function variantsOf(document) {
  const variants = document?.content?.variants;
  return Array.isArray(variants) ? variants : [];
}

function activeVariantIdOf(document, activeVariantId) {
  return String(activeVariantId || document?.content?.activeVariantId || variantsOf(document)[0]?.id || "");
}

function parseMagic(text) {
  const lineEnd = text.indexOf("\n");
  if (lineEnd < 0) throw new Error("ContainerのHeader形式が不正です。");
  const line = text.slice(0, lineEnd).replace(/\r$/, "");
  const match = MAGIC.exec(line);
  if (!match) throw new Error("Containerの形式が不正です。");
  return { version: Number(match[1]), lineEnd };
}

export function isLyricContainerText(value) {
  if (typeof value !== "string") return false;
  const text = value.replace(/^\uFEFF/, "");
  const lineEnd = text.indexOf("\n");
  if (lineEnd < 0) return false;
  return MAGIC.test(text.slice(0, lineEnd).replace(/\r$/, ""));
}

export function readerDocumentToContainer(document, activeVariantId = "") {
  const sourceDocument = record(document);
  const variants = variantsOf(sourceDocument);
  const activeId = activeVariantIdOf(sourceDocument, activeVariantId);
  const active = variants.find(variant => String(variant?.id || "") === activeId);
  if (!active || typeof active.source?.text !== "string") throw new Error("Containerに保存できるActive Sourceがありません。");
  const headerDocument = cloneJson(sourceDocument);
  headerDocument.content = { ...(headerDocument.content || {}), activeVariantId: activeId, variants: variants.map(variant => {
    const copy = cloneJson(variant);
    if (String(variant?.id || "") === activeId) copy.source = { kind: "body" };
    return copy;
  }) };
  return { header: { container: "lyric-reader", version: 1, document: headerDocument }, source: active.source.text, activeVariantId: activeId };
}

export function serializeLyricContainer(document, activeVariantId = "") {
  const container = readerDocumentToContainer(document, activeVariantId);
  return `LYRIC-READER/1\n${JSON.stringify(container.header)}\n\n${container.source}`;
}

export function parseLyricContainer(value) {
  if (typeof value !== "string") throw new Error("Container本文が文字列ではありません。");
  const text = value.replace(/^\uFEFF/, "");
  const { version, lineEnd } = parseMagic(text);
  const headerStart = lineEnd + 1;
  const headerEnd = text.indexOf("\n", headerStart);
  if (headerEnd < 0) throw new Error("ContainerのHeaderがありません。");
  const headerLine = text.slice(headerStart, headerEnd).replace(/\r$/, "");
  let bodyStart = headerEnd + 1;
  if (text.startsWith("\r\n", bodyStart)) bodyStart += 2;
  else if (text[bodyStart] === "\n") bodyStart += 1;
  else throw new Error("ContainerのHeaderと本文のdelimiterがありません。");
  let header;
  try { header = JSON.parse(headerLine); } catch { throw new Error("ContainerのJSON Header形式が不正です。"); }
  if (!record(header) || !record(header.document)) throw new Error("ContainerのReader Documentが不正です。");
  const document = header.document;
  const variants = variantsOf(document);
  const activeId = activeVariantIdOf(document, header.activeVariantId);
  const active = variants.find(variant => String(variant?.id || "") === activeId);
  if (!active || active.source?.kind !== "body") throw new Error("ContainerのActive Source参照が不正です。");
  const warnings = version === 1 ? [] : ["unknown-version"];
  return { kind: "lyric-container", version, header, source: text.slice(bodyStart), activeVariantId: activeId, warnings };
}

export function containerToReaderDocument(container) {
  const value = record(container);
  const header = record(value?.header);
  const document = record(header?.document);
  if (!document || typeof value.source !== "string") throw new Error("ContainerからReader Documentを復元できません。");
  const restored = cloneJson(document);
  const variants = variantsOf(restored);
  const activeId = activeVariantIdOf(restored, value.activeVariantId || header.activeVariantId);
  const active = variants.find(variant => String(variant?.id || "") === activeId);
  if (!active || active.source?.kind !== "body") throw new Error("ContainerのActive Source参照が不正です。");
  restored.content = { ...(restored.content || {}), activeVariantId: activeId, variants: variants.map(variant => {
    const copy = cloneJson(variant);
    if (String(variant?.id || "") === activeId) copy.source = { text: value.source, url: "container:" };
    return copy;
  }) };
  return restored;
}
