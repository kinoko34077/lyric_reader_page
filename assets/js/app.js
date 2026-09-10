import { loadInput, parseJsonText, parseLocalInput, validateSourceText } from "./data-loader.js";
import { MAX_READER_DOCUMENT_JSON_BYTES, MAX_SOURCE_BYTES } from "./config.js";
import { firstLineInfo, withFirstLineBody } from "./content-boundary.js";
import { boundedHistory, clone, documentFingerprint, documentIdentity, documentPayload, draftDiffers, draftPayload, draftStorageKey, localSourceIdentity, migrateReaderDocument, normalizeDraft, readerDocumentExtensions } from "./document-state.js";
import { applyPresentation, applyRubyPresentation, assertCapabilities, clearPresentation, clearRubyPresentation, getSyntaxAdapter, graphemes, isSafePresentationName, parseSource, replaceText, serializeSource, toPortableText, toPortableTextSafe } from "./syntax-adapter.js";
import { renderLyrics, rawText } from "./reader-view.js";
import { parseLyricContainer, serializeLyricContainer } from "./lyric-container.js";
import { normalizeRegistry, paletteValue, validateRegistry } from "./registry.js";
import { renderedBodySource as serializeRenderedBodySource } from "./editor-source.js";
import { parseSourceEditorInput } from "./source-editor.js";
import { activeVariant, normalizeActiveVariantId, normalizeDocumentData, normalizeVariants, replaceVariantSource, resolveMetadata, resolveTitle } from "./document-model.js";
import { captureScrollPosition, commitDocumentCandidate, restoreScrollPosition, scrollStorageKey } from "./runtime-integrity.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const requestedMode = params.get("mode");
const initialMode = requestedMode === "writer" || requestedMode === "source" ? requestedMode : "viewer";
const state = {
  activeVariantId: "variant-A", kanji: "original", ruby: true, writingMode: "horizontal", size: 20,
  font: "serif", fontUrl: "", background: "#f5f0e6", color: "#272522", paletteBank: "default",
  remoteFontsAllowed: true, loadedRegistryFonts: new Set(), data: null, nodes: [], selectionBookmark: null, compositionActive: false, compositionCommitPending: false, rubyEditActive: false, mode: initialMode,
  preferencesLoaded: false, sourceDirty: false, documentDirty: false, dirty: false, draft: null, history: [], historyIndex: -1, historyDocumentId: null, savedCheckpoint: null, storageAvailable: true
};
const PREFS_KEY = "lyric-reader:preferences:v1";
const TAB_ID_KEY = "lyric-reader:tab-id:v1";
function newTabId() { try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fall through */ } return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function resolveTabId() { try { if (!window.opener) { const stored = sessionStorage.getItem(TAB_ID_KEY); if (stored) return stored; } const next = newTabId(); sessionStorage.setItem(TAB_ID_KEY, next); return next; } catch { return newTabId(); } }
const TAB_ID = resolveTabId();
let historyTimer;
let fontRequestToken = 0;

const FONT_STACKS = {
  serif: '"Noto Serif JP", "Yu Mincho", YuMincho, serif', sans: '"Noto Sans JP", "Yu Gothic", YuGothic, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace', "yu-mincho": '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", serif',
  "noto-serif": '"Noto Serif JP", "Yu Mincho", YuMincho, serif', "noto-sans": '"Noto Sans JP", "Yu Gothic", YuGothic, sans-serif',
  "nishiki-teki": '"Nishiki-teki", "Noto Serif JP", "Yu Mincho", serif'
};
const WEB_FONT_URLS = { "noto-serif": "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;700&display=swap", "noto-sans": "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" };

function validColor(value, fallback) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback; }
function safeLink(value) { try { const url = new URL(value, location.href); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function currentRecord() { return activeVariant(state.data, state.activeVariantId); }
function currentRaw() { return currentRecord().source.text; }
function sourceInfo(record = currentRecord()) {
  const info = firstLineInfo(record.source.text);
  if (state.data.titleSource !== "first-line") {
    const title = resolveMetadata(state.data.sourceMetadata, state.data.metadata || state.data.manifest?.meta || state.data.manifest || {}).title;
    return { title: String(title || info.title || "無題"), body: record.source.text, bodyStart: 0, newline: "" };
  }
  return info;
}
function titleSourceText(record = currentRecord()) { return state.data.titleSource === "first-line" ? resolveTitle({ source: record.source.text }) : String(sourceInfo(record).title || "無題"); }
function currentBody() { return sourceInfo().body; }
function currentAdapter() { return assertCapabilities(getSyntaxAdapter(state.data?.manifest?.content?.format || "narou-text"), { ruby: true, presentationMarkup: true, escapedLiterals: true }); }
function draftKey() { const identity = state.data?.sourceIdentity || (state.data?.sourceName ? `${state.data.sourceUrl}:${state.data.sourceName}` : (state.data?.sourceUrl || location.hash || location.pathname)); return draftStorageKey(identity, TAB_ID); }
function syncSourceInput() { const source = state.data?.sourceUrl || ""; const shareable = /^https?:\/\//i.test(source); $("source-url").value = shareable ? source : ""; $("share-button").disabled = !shareable; $("source-copy-button").disabled = !shareable; $("reload-button").disabled = !shareable; $("reload-source-button").disabled = !shareable; }
function setStatus(text) { $("source-status").textContent = text; }
function clearReaderError() { const error = $("reader-error"); error.hidden = true; error.textContent = ""; }
function showReaderError(error, fallback = "読み込みに失敗しました。既存の本文は保持されています。", status = "読込失敗") { const message = error instanceof Error ? error.message : fallback; const target = $("reader-error"); target.hidden = false; target.textContent = message || fallback; setStatus(status); }
function isDirty() { return state.sourceDirty || state.documentDirty; }
function markDirty({ source = false, document = false } = {}) { state.sourceDirty ||= source; state.documentDirty ||= document; state.dirty = isDirty(); }
function clearDirty({ source = false, document = false } = {}) { if (source) state.sourceDirty = false; if (document) state.documentDirty = false; state.dirty = isDirty(); if (!state.dirty && state.data) state.savedCheckpoint = documentPayload(state.data, titleSourceText(), state.activeVariantId); }
function setCleanCheckpoint() { if (!state.data) return; state.sourceDirty = false; state.documentDirty = false; state.dirty = false; state.savedCheckpoint = documentPayload(state.data, titleSourceText(), state.activeVariantId); }
function updateDirtyFromCheckpoint() { if (!state.savedCheckpoint) return; const current = documentPayload(state.data, titleSourceText(), state.activeVariantId); const clean = JSON.stringify(current) === JSON.stringify(state.savedCheckpoint); state.sourceDirty = !clean; state.documentDirty = !clean; state.dirty = !clean; }
function updateStatus(text) { const fallback = !state.storageAvailable ? "自動復元利用不可（編集継続可）" : (state.sourceDirty && state.documentDirty ? "未保存の本文・文書変更" : (state.sourceDirty ? "未保存の本文" : (state.documentDirty ? "未保存の文書変更" : "読み込み済み"))); setStatus(text || fallback); document.body.dataset.dirty = String(isDirty()); }
function confirmReplaceCurrent() { return !isDirty() || confirm("未保存の変更があります。現在の本文を置き換えますか？"); }
function validatedManifest(manifest) { const { annotations: _legacyAnnotations, ...current } = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : {}; const result = validateRegistry(current.registry || {}); if (!result.valid) throw new Error(`Reader定義のRegistryが不正です。${result.errors.join(" ")}`); const warnings = [...new Set([...(Array.isArray(current.warnings) ? current.warnings : []), ...result.warnings])]; return { ...current, registry: normalizeRegistry(current.registry || {}), ...(warnings.length ? { warnings } : {}) }; }
function validateLoadedVariants(manifest, variants) { const adapter = assertCapabilities(getSyntaxAdapter(manifest?.content?.format || "narou-text"), { ruby: true, presentationMarkup: true, escapedLiterals: true }); const warnings = Array.isArray(manifest?.warnings) ? [...manifest.warnings] : []; for (const variant of variants || []) { try { adapter.parse(variant.source.text); } catch (error) { warnings.push(`source-parse-fallback:${variant.id}:${error instanceof Error ? error.message : "parse error"}`); } } if (warnings.length) manifest.warnings = [...new Set(warnings)]; return adapter; }

function applyManifest(manifest, preserveWritingMode = false, preserveUserView = false) {
  manifest = validatedManifest(manifest);
  if (state.data) state.data.manifest = manifest;
  const view = preserveUserView ? { activeVariantId: state.activeVariantId, kanji: state.kanji, ruby: state.ruby, writingMode: state.writingMode, size: state.size, font: state.font, fontUrl: state.fontUrl, background: state.background, color: state.color, paletteBank: state.paletteBank, remoteFontsAllowed: state.remoteFontsAllowed } : null;
  const defaults = manifest.defaults || manifest.theme?.defaults || {};
  state.activeVariantId = normalizeActiveVariantId(normalizeVariants(state.data || {}), defaults.variantId || manifest.activeVariantId || state.activeVariantId);
  state.kanji = defaults.kanji === "shinjitai" ? "shinjitai" : "original";
  state.ruby = defaults.ruby !== false;
  if (!preserveWritingMode) state.writingMode = defaults.writingMode === "vertical" ? "vertical" : "horizontal";
  const theme = manifest.theme || {};
  state.font = theme.font?.type === "remote" ? "custom" : (theme.font?.id || theme.font || "serif");
  state.fontUrl = theme.font?.type === "remote" ? String(theme.font.url || "") : "";
  const normalizedRegistry = normalizeRegistry(manifest.registry || {}); state.paletteBank = normalizedRegistry.banks[state.paletteBank] ? state.paletteBank : (normalizedRegistry.activeBank || "default"); state.background = validColor(theme.background, state.background); state.color = validColor(theme.color, paletteValue(normalizedRegistry, 0, state.paletteBank));
  if (view) Object.assign(state, view);
  const meta = resolveMetadata(state.data?.sourceMetadata || {}, manifest.meta || manifest);
  $("song-title").textContent = String(meta.title || "無題"); $("song-artist").textContent = String(meta.artist || meta.author || ""); $("song-description").textContent = String(meta.description || "");
  const linkTargets = [$('song-links'), $('footer-links')];
  for (const target of linkTargets) { target.replaceChildren(); for (const [label, value] of Object.entries(manifest.links || {})) { const href = safeLink(value); if (!href) continue; const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label; target.append(a); } }
  syncSourceInput(); syncControls();
}
function applyDocumentDefaults() { const manifest = state.data?.manifest || {}; const defaults = manifest.defaults || manifest.theme?.defaults || {}; const theme = manifest.theme || {}; const normalizedRegistry = normalizeRegistry(manifest.registry || {}); state.activeVariantId = normalizeActiveVariantId(normalizeVariants(state.data || {}), defaults.variantId || manifest.activeVariantId); state.kanji = defaults.kanji === "shinjitai" ? "shinjitai" : "original"; state.ruby = defaults.ruby !== false; state.writingMode = defaults.writingMode === "vertical" ? "vertical" : "horizontal"; state.font = theme.font?.type === "remote" ? "custom" : (theme.font?.id || theme.font || "serif"); state.fontUrl = theme.font?.type === "remote" ? String(theme.font.url || "") : ""; state.background = validColor(theme.background, "#f5f0e6"); state.paletteBank = normalizedRegistry.activeBank || "default"; state.color = validColor(theme.color, paletteValue(normalizedRegistry, 0, state.paletteBank)); state.remoteFontsAllowed = true; syncControls(); applyAppearance(); render(); savePreferences(); updateStatus("作品既定の表示設定に戻しました"); }
function syncControls() {
  const variantSelect = $("variant-mode"); const variants = normalizeVariants(state.data || {}); variantSelect.replaceChildren(...variants.map(variant => { const option = document.createElement("option"); option.value = variant.id; option.textContent = variant.label; return option; })); state.activeVariantId = normalizeActiveVariantId(variants, state.activeVariantId); variantSelect.value = state.activeVariantId; $("kanji-mode").value = state.kanji; $("ruby-toggle").checked = state.ruby; $("vertical-toggle").checked = state.writingMode === "vertical";
  $("font-family").value = state.font === "custom" || FONT_STACKS[state.font] ? state.font : "serif"; $("font-url").value = state.fontUrl; $("remote-font-toggle").checked = state.remoteFontsAllowed;
  $("background-color").value = state.background; $("text-color").value = state.color;
  $("size-range").value = state.size; $("size-value").textContent = `${state.size}px`;
  const nishiki = $("font-family").querySelector('option[value="nishiki-teki"]'); nishiki.disabled = !document.fonts.check('16px "Nishiki-teki"');
  syncPaletteControls();
}
function syncPaletteControls() { const bank = $("palette-bank"); const slot = $("palette-slot"); const color = $("palette-color"); if (!slot || !color) return; const normalized = normalizeRegistry(state.data?.manifest?.registry || {}); if (bank) { bank.replaceChildren(...Object.keys(normalized.banks).map(name => { const option = document.createElement("option"); option.value = name; option.textContent = name; return option; })); state.paletteBank = normalized.banks[state.paletteBank] ? state.paletteBank : normalized.activeBank; bank.value = state.paletteBank; } const selectedSlot = slot.value; const slots = normalized.banks[state.paletteBank]?.slots || normalized.palettes; const indices = [...new Set(["0", "1", "2", "3", ...Object.keys(slots || {})])].sort((a, b) => Number(a) - Number(b)); slot.replaceChildren(...indices.map(index => { const option = document.createElement("option"); option.value = index; option.textContent = normalized.banks[state.paletteBank]?.names?.[index] ? `Slot ${index} · ${normalized.banks[state.paletteBank].names[index]}` : `Slot ${index}`; return option; })); slot.value = indices.includes(selectedSlot) ? selectedSlot : (indices[0] || ""); const value = slots?.[slot.value] || paletteValue(normalized, Number(slot.value), state.paletteBank); if (validColor(value, "")) color.value = value; }
function applyAppearance() {
  const font = state.font === "custom" ? '"ReaderCustom", serif' : (FONT_STACKS[state.font] || FONT_STACKS.serif);
  document.documentElement.style.setProperty("--paper", state.background); document.documentElement.style.setProperty("--ink", state.color); document.documentElement.style.setProperty("--reader-font", font); document.documentElement.style.setProperty("--reader-size", `${state.size}px`);
  document.querySelector(".reader-shell").classList.toggle("is-vertical", state.writingMode === "vertical" && state.mode !== "source");
}
function storageGet(key) { try { return localStorage.getItem(key); } catch { state.storageAvailable = false; return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { state.storageAvailable = false; setStatus("自動復元用Storageを利用できません。編集は継続できます"); return false; } }
function storageRemove(key) { try { localStorage.removeItem(key); return true; } catch { state.storageAvailable = false; return false; } }
function savePreferences() { state.preferencesLoaded = true; try { storageSet(PREFS_KEY, JSON.stringify({ activeVariantId: state.activeVariantId, kanji: state.kanji, ruby: state.ruby, writingMode: state.writingMode, size: state.size, font: state.font, fontUrl: state.fontUrl, background: state.background, color: state.color, paletteBank: state.paletteBank, remoteFontsAllowed: state.remoteFontsAllowed })); } catch { state.storageAvailable = false; setStatus("自動復元用Storageを利用できません。編集は継続できます"); } }
function restorePreferences() { try { const saved = JSON.parse(storageGet(PREFS_KEY) || "null"); if (!saved) return false; Object.assign(state, { activeVariantId: saved.activeVariantId || saved.kana, kanji: saved.kanji, ruby: saved.ruby, writingMode: saved.writingMode, size: saved.size, font: saved.font, fontUrl: saved.fontUrl, background: saved.background, color: saved.color, paletteBank: saved.paletteBank, remoteFontsAllowed: saved.remoteFontsAllowed !== false }); state.kanji = state.kanji === "shinjitai" ? "shinjitai" : "original"; state.ruby = state.ruby !== false; state.writingMode = state.writingMode === "vertical" ? "vertical" : "horizontal"; state.size = Number.isFinite(Number(state.size)) ? Math.max(14, Math.min(32, Number(state.size))) : 20; state.background = validColor(state.background, "#f5f0e6"); state.color = validColor(state.color, "#272522"); state.paletteBank = typeof state.paletteBank === "string" ? state.paletteBank : "default"; state.preferencesLoaded = true; return true; } catch { storageRemove(PREFS_KEY); return false; } }
function applyMode() { const source = state.mode === "source"; const writer = state.mode === "writer"; document.body.dataset.mode = state.mode; $("mode-switch").textContent = writer ? "閲覧" : "編集"; $("source-mode-switch").textContent = source ? "閲覧" : "Source"; $("source-mode-switch").setAttribute("aria-pressed", String(source)); $("song-title").contentEditable = String(writer); $("lyrics").contentEditable = String(writer); $("reader-heading").hidden = source; $("lyrics").hidden = source; $("source-editor").hidden = !source; $("kanji-mode").disabled = writer || source; $("editing-actions").hidden = !writer; }
function updateUrlMode() { const url = new URL(location.href); if (state.mode === "writer" || state.mode === "source") url.searchParams.set("mode", state.mode); else url.searchParams.delete("mode"); history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`); }

function scrollIdentity() { return documentIdentity(state.data); }
function captureScroll() { const shell = $("reader-shell"); const lyrics = $("lyrics"); const visible = [...lyrics.querySelectorAll("[data-source-start]")].find(node => { const rect = node.getBoundingClientRect(); const parent = shell.getBoundingClientRect(); return rect.bottom > parent.top && rect.top < parent.bottom && rect.right > parent.left && rect.left < parent.right; }); const position = captureScrollPosition({ scrollTop: shell.scrollTop, scrollLeft: shell.scrollLeft, scrollHeight: shell.scrollHeight, scrollWidth: shell.scrollWidth, clientHeight: shell.clientHeight, clientWidth: shell.clientWidth, anchor: visible ? Number(visible.dataset.sourceStart) : null }); return { offset: position.anchor, ...position }; }
function savedScroll() { try { const value = JSON.parse(storageGet(scrollStorageKey(scrollIdentity())) || "null"); return value && typeof value === "object" ? { offset: value.anchor, ...value } : null; } catch { return null; } }
function saveScroll() { try { storageSet(scrollStorageKey(scrollIdentity()), JSON.stringify(captureScroll())); } catch { /* Storage loss must not stop reading or editing. */ } }
function restoreScroll(anchor) { requestAnimationFrame(() => { const shell = $("reader-shell"); const lyrics = $("lyrics"); const target = anchor?.offset == null ? null : [...lyrics.querySelectorAll("[data-source-start]")].find(node => Number(node.dataset.sourceStart) >= anchor.offset); if (target) target.scrollIntoView({ block: "nearest", inline: "nearest" }); else { const restored = restoreScrollPosition(anchor || {}, { scrollHeight: shell.scrollHeight, scrollWidth: shell.scrollWidth, clientHeight: shell.clientHeight, clientWidth: shell.clientWidth }); shell.scrollTop = restored.top; shell.scrollLeft = restored.left; } saveScroll(); }); }
function syncSourceEditor() { const editor = $("source-editor"); if (editor && state.data) { editor.value = currentRaw(); editor.setCustomValidity(""); editor.removeAttribute("aria-invalid"); } }
function sourceInput() { if (state.mode !== "source" || !state.data) return; const editor = $("source-editor"); const start = editor.selectionStart; const end = editor.selectionEnd; const result = parseSourceEditorInput(editor.value, currentAdapter()); if (!result.ok) { editor.setCustomValidity(result.error.message); editor.setAttribute("aria-invalid", "true"); const offset = result.error.sourceLocation?.offset; if (Number.isInteger(offset)) { editor.focus({ preventScroll: true }); const markerEnd = offset < editor.value.length ? offset + 1 : offset; editor.setSelectionRange(offset, markerEnd); } const context = result.error.sourceContext ? ` 付近「${result.error.sourceContext}」` : ""; setStatus(`Sourceを反映できません: ${result.error.message}${context}`); return; } clearReaderError(); editor.setCustomValidity(""); editor.removeAttribute("aria-invalid"); const record = currentRecord(); state.data = replaceVariantSource(state.data, record.id, result.source); state.nodes = result.document.nodes; if (state.data.titleSource === "first-line") state.data.manifest.title = resolveTitle({ source: result.source }); markDirty({ source: true }); saveDraft(); scheduleHistory(); render(captureScroll()); editor.focus(); editor.setSelectionRange(Math.min(start, editor.value.length), Math.min(end, editor.value.length)); updateStatus(); }
function setMode(mode) { state.mode = mode; applyMode(); applyAppearance(); updateUrlMode(); if (state.data) { render(); syncSourceEditor(); } updateStatus(mode === "writer" ? "編集中" : mode === "source" ? "Source編集中" : undefined); savePreferences(); }
function render(anchor = captureScroll()) { const renderOptions = state.mode === "writer" ? { ...state, kanji: "original", registry: state.data?.manifest?.registry, loadedRegistryFonts: state.loadedRegistryFonts, adapter: currentAdapter() } : { ...state, registry: state.data?.manifest?.registry, loadedRegistryFonts: state.loadedRegistryFonts, adapter: currentAdapter() }; state.nodes = renderLyrics($("lyrics"), currentBody(), renderOptions); renderLyrics($("song-title"), titleSourceText(), renderOptions); applyMode(); syncSourceEditor(); restoreScroll(anchor); }
function snapshot() { return documentPayload(state.data, titleSourceText(), state.activeVariantId); }
function resetHistory() { state.history = []; state.historyIndex = -1; state.historyDocumentId = documentIdentity(state.data); }
function pushHistory() { if (!state.data) return; const result = boundedHistory(state.history, state.historyIndex, snapshot()); state.history = result.history; state.historyIndex = result.index; state.historyDocumentId = documentIdentity(state.data); updateHistoryButtons(); }
function checkpointBeforeDocumentOpen() { clearTimeout(historyTimer); if (state.data) pushHistory(); }
function restoreSnapshot(item) { if (!item || !Array.isArray(item.variants)) return; const nextManifest = validatedManifest(item.manifest || state.data.manifest); const nextVariants = normalizeVariants({ variants: clone(item.variants || state.data.variants) }); validateLoadedVariants(nextManifest, nextVariants); const nextData = { ...state.data, variants: nextVariants, links: clone(item.links || state.data.links || []), variantOverrides: clone(item.variantOverrides || state.data.variantOverrides || {}), metadata: clone(item.metadata || state.data.metadata || {}), sourceMetadata: clone(item.sourceMetadata || state.data.sourceMetadata || {}), titleSource: item.titleSource || state.data.titleSource, manifest: nextManifest, documentExtensions: clone(item.documentExtensions || state.data.documentExtensions || {}), sourceUrl: item.sourceUrl ?? state.data.sourceUrl, sourceName: item.sourceName ?? state.data.sourceName, sourceIdentity: item.sourceIdentity ?? state.data.sourceIdentity }; state.data = nextData; clearReaderError(); state.activeVariantId = normalizeActiveVariantId(nextVariants, item.activeVariantId); state.historyDocumentId = documentIdentity(nextData); state.draft = null; $("draft-notice").hidden = true; state.loadedRegistryFonts = new Set(); applyManifest(state.data.manifest, true, true); applyAppearance(); render(); void loadConfiguredFont().then(() => render(captureScroll())).catch(() => render(captureScroll())); updateDirtyFromCheckpoint(); saveDraft(); updateStatus(); }
function updateHistoryButtons() { $("undo-button").disabled = state.historyIndex <= 0; $("redo-button").disabled = state.historyIndex >= state.history.length - 1; }
function saveDraft() { if (!state.data) return; if (!isDirty()) { storageRemove(draftKey()); state.draft = null; $("draft-notice").hidden = true; return; } try { const current = documentPayload(state.data, titleSourceText(), state.activeVariantId); const base = state.savedCheckpoint || current; storageSet(draftKey(), JSON.stringify(draftPayload(state.data, titleSourceText(), state.activeVariantId, { baseDocumentHash: documentFingerprint(base), dirtyAtSave: true }))); } catch { state.storageAvailable = false; setStatus("自動復元用Storageを利用できません。編集は継続できます"); } }
function scheduleHistory() { clearTimeout(historyTimer); historyTimer = setTimeout(pushHistory, 500); }
function clearDraft() { storageRemove(draftKey()); state.draft = null; $("draft-notice").hidden = true; }
function showDraftIfNeeded() { $("draft-notice").hidden = true; state.draft = null; try { const draft = normalizeDraft(JSON.parse(storageGet(draftKey()) || "null")); const current = documentPayload(state.data, titleSourceText(), state.activeVariantId); const identityMatches = !draft?.sourceIdentity || draft.sourceIdentity === current.sourceIdentity; const baseMatches = !draft?.baseDocumentHash || draft.baseDocumentHash === documentFingerprint(current); const isDirtyDraft = draft?.dirtyAtSave !== false; if (draft && identityMatches && baseMatches && isDirtyDraft && draftDiffers(draft, current)) { state.draft = draft; $("draft-notice").hidden = false; } } catch { storageRemove(draftKey()); } }
function applyDraft() {
  if (!state.draft) return;
  try {
    const payload = state.draft.document;
    if (!payload || typeof payload !== "object") throw new Error("Draftの文書形式が不正です。");
    const nextManifest = validatedManifest(payload.manifest);
    const nextVariants = normalizeVariants({ variants: clone(payload.variants || normalizeVariants(payload)) });
    if (!nextVariants.some(variant => variant.source.text)) throw new Error("Draftに本文がありません。");
    for (const variant of nextVariants) validateSourceText(variant.source.text);
    validateLoadedVariants(nextManifest, nextVariants);
    const nextData = { ...state.data, variants: nextVariants, links: clone(payload.links || []), variantOverrides: clone(payload.variantOverrides || {}), metadata: clone(payload.metadata || state.data.metadata || {}), sourceMetadata: clone(payload.sourceMetadata || {}), titleSource: payload.titleSource || "first-line", manifest: nextManifest, documentExtensions: clone(payload.documentExtensions || {}), sourceUrl: payload.sourceUrl ?? state.data.sourceUrl, sourceName: payload.sourceName ?? state.data.sourceName, sourceIdentity: payload.sourceIdentity ?? state.data.sourceIdentity };
    state.data = nextData;
    clearReaderError();
    state.activeVariantId = normalizeActiveVariantId(nextVariants, payload.activeVariantId);
    applyManifest(state.data.manifest, true, true);
    applyAppearance();
    render();
    markDirty({ source: true, document: true });
    saveDraft();
    $("draft-notice").hidden = false;
    updateStatus("未保存の編集を復元しました");
    pushHistory();
  } catch (error) {
    state.draft = null;
    $("draft-notice").hidden = true;
    const message = error instanceof Error ? error.message : "Draftの形式が不正です。";
    setStatus(`Draftを復元できません: ${message} 現在の本文は保持されています`);
  }
}
function titleInput() { const title = renderedBodySource($("song-title")).replace(/[\r\n]/g, "").trim() || "無題"; const record = currentRecord(); if (state.data.titleSource === "first-line") { const raw = record.source.text; const info = sourceInfo(record); const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : ""; const nextText = `${bom}${title}${info.newline}${raw.slice(info.bodyStart)}`; try { currentAdapter().parse(nextText); } catch (error) { setStatus(error instanceof Error ? error.message : "タイトルを更新できませんでした"); render(captureScroll()); return; } state.data = replaceVariantSource(state.data, record.id, nextText); } else { state.data.sourceMetadata = { ...(state.data.sourceMetadata || {}), title }; } markDirty({ source: state.data.titleSource === "first-line", document: state.data.titleSource !== "first-line" }); saveDraft(); scheduleHistory(); render(captureScroll()); updateStatus(); }
function selectionTouchesRuby() {
  const selection = window.getSelection(); const lyrics = $("lyrics");
  if (!selection || !selection.rangeCount || !lyrics?.contains(selection.getRangeAt(0).commonAncestorContainer)) return false;
  const range = selection.getRangeAt(0);
  const owner = container => (container?.nodeType === Node.ELEMENT_NODE ? container : container?.parentElement)?.closest(".source-ruby");
  if (range.collapsed) {
    const ruby = owner(range.startContainer)?.querySelector("ruby");
    return Boolean(ruby?.contains(range.startContainer));
  }
  if (owner(range.startContainer) || owner(range.endContainer)) return true;
  for (const ruby of lyrics.querySelectorAll(".source-ruby")) {
    try { if (range.intersectsNode(ruby)) return true; } catch { /* Safari may reject a detached selection endpoint. */ }
  }
  return false;
}
function renderedBodySource(container = $("lyrics"), options = {}) { return serializeRenderedBodySource(container, currentAdapter(), { ...options, preserveRuby: options.preserveRuby ?? !state.rubyEditActive }); }
function bodyInput(options = {}) { const caret = caretOffset(); const editRuby = options.editRuby ?? (state.rubyEditActive || selectionTouchesRuby()); const rawBody = renderedBodySource($("lyrics"), { editRuby }); const record = currentRecord(); const nextText = state.data.titleSource === "first-line" ? withFirstLineBody(record.source.text, rawBody) : rawBody; let parsed; try { parsed = currentAdapter().parse(nextText); } catch (error) { setStatus(error instanceof Error ? error.message : "本文を更新できませんでした"); render(captureScroll()); return; } finally { state.rubyEditActive = false; } state.selectionBookmark = null; state.data = replaceVariantSource(state.data, record.id, nextText); state.nodes = parsed.nodes; markDirty({ source: true }); saveDraft(); scheduleHistory(); render(captureScroll()); restoreCaret(caret); updateStatus(); }
function commitSemanticTextEdit(range, value) { const document = replaceText({ type: "document", nodes: state.nodes }, range, value); writeBodyDocument(document); restoreCaret(Number(range.start) + graphemes(value).length); }
function preserveWysiwygTextInput(event) { if (state.mode !== "writer" || state.compositionActive || event.isComposing || !["insertText", "insertReplacementText"].includes(event.inputType) || typeof event.data !== "string" || !event.data) return false; state.rubyEditActive = selectionTouchesRuby(); const selection = window.getSelection(); const lyrics = $("lyrics"); if (!selection || !selection.rangeCount || !lyrics?.contains(selection.getRangeAt(0).commonAncestorContainer)) return false; if (selection.isCollapsed && !state.rubyEditActive) { const start = caretOffset(); if (start == null) return false; event.preventDefault(); commitSemanticTextEdit({ start, end: start }, event.data); state.rubyEditActive = false; return true; } if (selection.isCollapsed) return false; const range = selection.getRangeAt(0); event.preventDefault(); range.deleteContents(); const node = document.createTextNode(event.data); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); bodyInput({ editRuby: state.rubyEditActive }); return true; }
function handleWysiwygBeforeInput(event) { state.rubyEditActive = state.mode === "writer" && selectionTouchesRuby(); preserveWysiwygTextInput(event); }
function writeBodyDocument(document, documentChanged = false) { const record = currentRecord(); const adapter = currentAdapter(); const serialized = serializeSource(document, adapter); const nextText = state.data.titleSource === "first-line" ? withFirstLineBody(record.source.text, serialized) : serialized; try { adapter.parse(nextText); } catch (error) { setStatus(error instanceof Error ? error.message : "本文を更新できませんでした"); return; } state.selectionBookmark = null; state.data = replaceVariantSource(state.data, record.id, nextText); state.nodes = document.nodes; render(); markDirty({ source: true, document: documentChanged }); saveDraft(); pushHistory(); updateStatus(); }
async function hashText(text) { const bytes = new TextEncoder().encode(text); if (globalThis.crypto?.subtle) { try { const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join(""); } catch { /* fall through to a deterministic local fingerprint */ } } let hash = 2166136261; for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
function setLocalSource(text, name = "ローカル本文", sourceIdentity = "", format = "narou-text") { const raw = String(text); const title = resolveTitle({ source: raw, fallback: name.replace(/\.(txt|json)$/i, "") || "ローカル本文" }); const variants = [{ id: "variant-A", label: "Variant A", role: "", source: { text: raw, url: "local:" } }]; const manifest = validatedManifest({ title, description: "この本文はブラウザ内だけで読み込んでいます。", content: { format } }); validateLoadedVariants(manifest, variants); checkpointBeforeDocumentOpen(); state.loadedRegistryFonts = new Set(); state.data = { manifest, variants, activeVariantId: variants[0].id, links: [], variantOverrides: {}, titleSource: "first-line", sourceMetadata: {}, metadata: { title }, sourceUrl: "local:", sourceName: name, sourceIdentity: sourceIdentity || localSourceIdentity(name, new TextEncoder().encode(raw).byteLength, 0) }; clearReaderError(); state.activeVariantId = variants[0].id; clearDirty({ source: true, document: true }); applyManifest(state.data.manifest, true, true); applyAppearance(); render({ offset: 0, top: 0, left: 0 }); setCleanCheckpoint(); showDraftIfNeeded(); updateStatus(`「${title}」を表示中`); pushHistory(); }
async function readLocalFile(file) { if (!file) return; if (!confirmReplaceCurrent()) { $("source-file").value = ""; return; } try { const likelyContainer = /\.lyric\.txt$/i.test(file.name); const likelyJson = !likelyContainer && /\.json$/i.test(file.name); const maximum = likelyContainer ? MAX_READER_DOCUMENT_JSON_BYTES + MAX_SOURCE_BYTES : likelyJson ? MAX_READER_DOCUMENT_JSON_BYTES : MAX_SOURCE_BYTES; if (Number.isFinite(file.size) && file.size > maximum) throw new Error(likelyContainer || likelyJson ? "Reader文書が大きすぎます。" : "本文が大きすぎます。"); const text = await file.text(); const fileIdentity = file.webkitRelativePath || file.name; const identity = localSourceIdentity(fileIdentity, file.size, file.lastModified, await hashText(text)); const loaded = parseLocalInput(text, file.name, file.type); if (loaded.kind === "reader-document") { setReaderDocument(loaded.document, file.name, identity); if (loaded.warnings?.length) setStatus("未知のContainer Versionを読み込みました。現行形式で保存してください"); } else setLocalSource(loaded.source, file.name, identity, loaded.format); } catch (error) { $("reader-error").hidden = false; $("reader-error").textContent = error instanceof Error ? error.message : "ファイルの形式を確認してください。既存の本文は保持されています。"; setStatus("読込失敗"); } finally { $("source-file").value = ""; } }
function setReaderDocument(doc, name = "Reader文書", sourceIdentity = "") {
  let migrationWarnings = [];
  const previous = { data: state.data, activeVariantId: state.activeVariantId, loadedRegistryFonts: state.loadedRegistryFonts, history: state.history, historyIndex: state.historyIndex, historyDocumentId: state.historyDocumentId, savedCheckpoint: state.savedCheckpoint };
  const candidate = commitDocumentCandidate(previous.data, doc, value => {
    value = migrateReaderDocument(value); migrationWarnings = Array.isArray(value.warnings) ? value.warnings : []; const contentMeta = typeof value?.content === "object" && value.content ? value.content : {}; const variants = normalizeVariants(contentMeta);
    if (!variants.some(variant => variant.source.text)) throw new Error("Reader文書に本文がありません。");
    for (const variant of variants) validateSourceText(variant.source.text);
    const meta = value.meta || value; const sourceMetadata = value.sourceMetadata && typeof value.sourceMetadata === "object" && Object.keys(value.sourceMetadata).length ? value.sourceMetadata : (contentMeta.sourceMetadata || {});
    const semanticLinks = Array.isArray(contentMeta.links) ? contentMeta.links : (Array.isArray(value.links) ? value.links : []); const externalLinks = value.links && typeof value.links === "object" && !Array.isArray(value.links) ? value.links : {};
    const manifest = validatedManifest({ ...value, ...(value.meta || {}), title: meta.title || "Reader文書", content: { format: contentMeta.format || value.format || "narou-text" }, defaults: value.defaults || {}, theme: value.theme || {}, registry: value.registry || {}, links: externalLinks }); migrationWarnings = [...new Set([...migrationWarnings, ...(manifest.warnings || [])])];
    validateLoadedVariants(manifest, variants);
    return { manifest, variants, activeVariantId: normalizeActiveVariantId(variants, contentMeta.activeVariantId || value.activeVariantId), links: semanticLinks, variantOverrides: contentMeta.variantOverrides || value.variantOverrides || {}, titleSource: contentMeta.titleSource || value.titleSource || "first-line", sourceMetadata, metadata: meta, documentExtensions: readerDocumentExtensions(value), sourceUrl: "reader:", sourceName: name, sourceIdentity };
  });
  if (!candidate.ok) throw candidate.error;
  try {
    checkpointBeforeDocumentOpen(); state.loadedRegistryFonts = new Set(); state.data = candidate.value; clearReaderError(); state.activeVariantId = state.data.activeVariantId; if (state.data.titleSource === "first-line") state.data.manifest.title = titleSourceText(activeVariant(state.data)); clearDirty({ source: true, document: true }); applyManifest(state.data.manifest, true, true); applyAppearance(); render(savedScroll() || { offset: 0, top: 0, left: 0 }); void loadConfiguredFont().then(() => render(captureScroll())).catch(error => { render(captureScroll()); setStatus(error instanceof Error ? error.message : "フォントを読み込めませんでした"); }); setCleanCheckpoint(); showDraftIfNeeded(); updateStatus(migrationWarnings.includes("unknown-version") ? `${name}を現行形式へ変換して読み込みました。保存時も現行形式になります` : migrationWarnings.length ? `${name}を読み込みました（一部のReader定義に警告があります）` : `${name}を読み込みました`); pushHistory();
  } catch (error) { Object.assign(state, previous); throw error; }
}
function buildReaderDocument() { return { ...(state.data.documentExtensions || {}), version: 3, content: { variants: normalizeVariants(state.data).map(variant => ({ ...variant, source: { ...variant.source } })), activeVariantId: state.activeVariantId, links: state.data.links || [], variantOverrides: state.data.variantOverrides || {}, format: state.data.manifest.content?.format || "narou-text", titleSource: state.data.titleSource }, meta: { title: titleSourceText(), artist: $("song-artist").textContent, description: $("song-description").textContent }, sourceMetadata: state.data.sourceMetadata || {}, theme: { font: state.font === "custom" ? { type: "remote", url: state.fontUrl } : state.font, background: state.background, color: state.color }, defaults: { variantId: state.activeVariantId, kanji: state.kanji, ruby: state.ruby, writingMode: state.writingMode }, registry: state.data.manifest.registry || {}, links: Object.fromEntries([...$("song-links").querySelectorAll("a")].map(a => [a.textContent, a.href])) }; }
function filename(extension) { const title = ($( "song-title").textContent || "lyrics").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "lyrics"; return `${title}.${extension}`; }
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); }
async function copy(text) { try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable"); await navigator.clipboard.writeText(text); setStatus("コピーしました"); return true; } catch { try { const area = document.createElement("textarea"); area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select(); const ok = document.execCommand("copy"); area.remove(); if (ok) { setStatus("コピーしました"); return true; } } catch { /* fall through */ } setStatus("コピーに失敗しました。本文を選択してコピーしてください"); return false; }
}
async function loadWebFont(font) { if (!WEB_FONT_URLS[font]) return; const id = `reader-font-${font}`; if (!document.getElementById(id)) { const link = document.createElement("link"); link.id = id; link.rel = "stylesheet"; link.href = WEB_FONT_URLS[font]; document.head.append(link); } await document.fonts.ready; }
async function loadRemoteFont(url) { let target; try { target = new URL(url); } catch { throw new Error("HTTPSのフォントURLのみ指定できます。"); } if (target.protocol !== "https:") throw new Error("HTTPSのフォントURLのみ指定できます。"); const token = ++fontRequestToken; const face = new FontFace("ReaderCustom", `url(${JSON.stringify(target.href)})`); await face.load(); if (token !== fontRequestToken) return; document.fonts.add(face); state.font = "custom"; state.fontUrl = target.href; applyAppearance(); savePreferences(); }
async function loadRegistryFonts() { const loaded = new Set(); if (!state.remoteFontsAllowed) { state.loadedRegistryFonts = loaded; return loaded; } for (const [name, definition] of Object.entries(state.data?.manifest?.registry?.fonts || {})) { try { const face = new FontFace(`ReaderFont-${name}`, `url(${JSON.stringify(definition.url)})`); await face.load(); document.fonts.add(face); loaded.add(name); } catch { /* Text remains readable with the original Source fallback. */ } } state.loadedRegistryFonts = loaded; return loaded; }
async function loadConfiguredFont() { await loadRegistryFonts(); if (state.remoteFontsAllowed && state.font === "custom" && state.fontUrl) { try { await loadRemoteFont(state.fontUrl); } catch (error) { state.font = "serif"; state.fontUrl = ""; syncControls(); applyAppearance(); throw error; } } else if (state.remoteFontsAllowed && WEB_FONT_URLS[state.font]) await loadWebFont(state.font); }
async function reloadSource() {
  if (!state.data?.sourceUrl || state.data.sourceUrl === "local:" || state.data.sourceUrl === "reader:") { setStatus("現在の本文はローカル編集用です"); return; }
  if (isDirty() && !confirm("未保存の変更があります。外部本文を再読込しますか？")) return;
  try {
    const loaded = await loadInput();
    loaded.manifest = validatedManifest(loaded.manifest);
    const nextData = normalizeDocumentData(loaded);
    validateLoadedVariants(nextData.manifest, nextData.variants);
    checkpointBeforeDocumentOpen();
    state.loadedRegistryFonts = new Set();
    state.data = nextData;
    clearReaderError();
    state.activeVariantId = normalizeActiveVariantId(state.data.variants, loaded.activeVariantId);
    state.data.titleSource = loaded.titleSource || "first-line";
    if (state.data.titleSource === "first-line") state.data.manifest.title = resolveTitle({ source: activeVariant(state.data).source.text });
    clearDirty({ source: true, document: true });
    applyManifest(state.data.manifest, true, true);
    applyAppearance();
    render({ offset: 0, top: 0, left: 0 });
    void loadConfiguredFont().then(() => render(captureScroll())).catch(error => { render(captureScroll()); setStatus(error instanceof Error ? error.message : "フォントを読み込めませんでした"); });
    setCleanCheckpoint();
    showDraftIfNeeded();
    updateStatus("再読込しました");
    pushHistory();
  } catch (error) {
    showReaderError(error, "再読込に失敗しました。既存の本文は保持されています。", "再読込失敗");
  }
}
async function openUrlSource() {
  const value = $("source-url").value.trim();
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP(S) URLのみ指定できます。");
    if (!confirmReplaceCurrent()) return;
    const loaded = await loadInput(`#src=${encodeURIComponent(url.href)}`);
    loaded.manifest = validatedManifest(loaded.manifest);
    const nextData = normalizeDocumentData(loaded);
    validateLoadedVariants(nextData.manifest, nextData.variants);
    checkpointBeforeDocumentOpen();
    state.loadedRegistryFonts = new Set();
    state.data = nextData;
    clearReaderError();
    state.activeVariantId = normalizeActiveVariantId(state.data.variants, loaded.activeVariantId);
    state.data.titleSource = loaded.titleSource || "first-line";
    if (state.data.titleSource === "first-line") state.data.manifest.title = resolveTitle({ source: activeVariant(state.data).source.text });
    clearDirty({ source: true, document: true });
    applyManifest(state.data.manifest, true, true);
    applyAppearance();
    render({ offset: 0, top: 0, left: 0 });
    void loadConfiguredFont().then(() => render(captureScroll())).catch(error => { render(captureScroll()); setStatus(error instanceof Error ? error.message : "フォントを読み込めませんでした"); });
    setCleanCheckpoint();
    const pageUrl = new URL(location.href);
    pageUrl.hash = `src=${encodeURIComponent(url.href)}`;
    history.replaceState(null, "", `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
    showDraftIfNeeded();
    updateStatus("URL本文を読み込みました");
    pushHistory();
  } catch (error) {
    syncSourceInput();
    showReaderError(error, "URL本文を読み込めませんでした。既存の本文は保持されています。", "URL本文の読込失敗");
  }
}

function caretOffset() { const selection = window.getSelection(); if (!selection || !selection.rangeCount) return null; const range = selection.getRangeAt(0); const owner = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest("[data-source-start]"); if (!owner) return null; const prefix = document.createRange(); prefix.selectNodeContents(owner); try { prefix.setEnd(range.startContainer, range.startOffset); return Math.min(Number(owner.dataset.sourceEnd), Number(owner.dataset.sourceStart) + graphemes(prefix.toString()).length); } catch { return Number(owner.dataset.sourceStart); } }
function restoreCaret(offset) {
  if (offset == null) return;
  requestAnimationFrame(() => {
    const lyrics = $("lyrics");
    const candidates = [...lyrics.querySelectorAll("[data-source-start][data-source-end]")]
      .filter(node => Number(node.dataset.sourceStart) <= offset && offset <= Number(node.dataset.sourceEnd) && node.textContent)
      .sort((a, b) => (Number(a.dataset.sourceEnd) - Number(a.dataset.sourceStart)) - (Number(b.dataset.sourceEnd) - Number(b.dataset.sourceStart)));
    const owner = candidates[0];
    if (!owner) return;
    const start = Number(owner.dataset.sourceStart);
    const local = Math.max(0, Math.min(graphemes(owner.textContent || "").length, offset - start));
    const target = graphemes(owner.textContent || "").slice(0, local).join("");
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
    let remaining = target.length; let textNode;
    while ((textNode = walker.nextNode())) {
      const length = (textNode.nodeValue || "").length;
      if (remaining <= length) {
        const range = document.createRange(); range.setStart(textNode, remaining); range.collapse(true);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
      }
      remaining -= length;
    }
  });
}
function selectionOffsets() {
  const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const rubyMarker = container => (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)?.closest("[data-ruby-part]");
  const rubyOwner = container => (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)?.closest(".source-ruby");
  const rubyPosition = (container, point) => {
    const owner = rubyMarker(container); if (!owner) return null;
    const prefix = document.createRange(); prefix.selectNodeContents(owner);
    try { prefix.setEnd(container, point); } catch { return null; }
    const part = owner.dataset.rubyPart === "base" ? "base" : "ruby"; const local = Number(owner.dataset.rubyStart || 0) + graphemes(prefix.toString()).length;
    return { nodeIndex: Number(owner.dataset.rubyIndex), part, start: local, end: local, baseLength: Number(owner.closest(".source-ruby")?.dataset.sourceEnd || 0) - Number(owner.closest(".source-ruby")?.dataset.sourceStart || 0) };
  };
  const rubyStart = rubyPosition(range.startContainer, range.startOffset); const rubyEnd = rubyPosition(range.endContainer, range.endOffset);
  if (rubyStart && rubyEnd && rubyStart.nodeIndex === rubyEnd.nodeIndex && rubyStart.part === rubyEnd.part) {
    const start = Math.min(rubyStart.start, rubyEnd.start); const end = Math.max(rubyStart.end, rubyEnd.end);
    return { ruby: { nodeIndex: rubyStart.nodeIndex, part: rubyStart.part, start, end } };
  }
  const marker = container => (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)?.closest("[data-source-start]");
  const position = (container, point) => { const owner = marker(container); if (!owner) return null; const start = Number(owner.dataset.sourceStart); if (container.nodeType !== Node.TEXT_NODE) return start; const prefix = document.createRange(); prefix.selectNodeContents(owner); try { prefix.setEnd(container, point); return Math.min(Number(owner.dataset.sourceEnd), start + graphemes(prefix.toString()).length); } catch { return start; } };
  const start = position(range.startContainer, range.startOffset); const end = position(range.endContainer, range.endOffset); if (start == null || end == null) return null; return { start: Math.min(start, end), end: Math.max(start, end) };
}
function containsRubyNode(nodes = []) { return nodes.some(node => node.type === "ruby" || (node.type === "span" && containsRubyNode(node.children || []))); }
function insertPastedText(range, text) {
  const value = String(text || "");
  if (!value) return null;
  let inserted = [];
  try {
    const parsed = currentAdapter().parse(value);
    if (containsRubyNode(parsed.nodes || [])) {
      const staging = document.createElement("span");
      renderLyrics(staging, value, { ...state, mode: "writer", preserveSource: true, adapter: currentAdapter(), registry: state.data?.manifest?.registry, loadedRegistryFonts: state.loadedRegistryFonts });
      inserted = [...staging.childNodes];
      if (inserted.length) {
        const fragment = document.createDocumentFragment();
        inserted.forEach(node => fragment.append(node));
        range.deleteContents();
        range.insertNode(fragment);
      }
    }
  } catch { inserted = []; }
  if (!inserted.length) {
    const node = document.createTextNode(value);
    range.deleteContents();
    range.insertNode(node);
    inserted = [node];
  }
  const last = inserted.at(-1);
  if (last) { range.setStartAfter(last); range.collapse(true); }
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  return inserted;
}
function rememberSelection() {
  const selection = window.getSelection(); const lyrics = $("lyrics");
  if (!selection || selection.isCollapsed || !selection.rangeCount || !lyrics?.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
  const range = selectionOffsets(); if (range) state.selectionBookmark = structuredClone(range);
}
function selectedEditedSource() { const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return ""; const source = renderedBodySource(selection.getRangeAt(0).cloneContents()); try { const adapter = currentAdapter(); return toPortableText(parseSource(source, adapter), adapter); } catch { return source; } }
function bindCompositionGuards() {
  const editables = [$("lyrics"), $("song-title")];
  for (const editable of editables) editable.addEventListener("compositionstart", () => { state.compositionActive = true; });
  document.addEventListener("compositionend", event => { if (editables.includes(event.target)) state.compositionActive = false; }, true);
  document.addEventListener("input", event => {
    if (!editables.includes(event.target)) return;
    if (state.compositionActive || event.isComposing) event.stopImmediatePropagation();
  }, true);
}
function normalizeActivePaletteRegistry() {
  const normalized = normalizeRegistry(state.data?.manifest?.registry || {});
  state.paletteBank = normalized.banks[state.paletteBank] ? state.paletteBank : (normalized.activeBank || "default");
  return normalized;
}
function setPaletteRegistry(registry) {
  state.data.manifest.registry = { ...registry, activeBank: state.paletteBank, palettes: registry.banks.default.slots, paletteNames: registry.banks.default.names };
}
function handlePaletteBankChange(event) {
  if (!state.data) return;
  const registry = normalizeRegistry(state.data.manifest.registry || {});
  const requested = event?.target?.value;
  state.paletteBank = registry.banks[requested] ? requested : (registry.activeBank || "default");
  setPaletteRegistry(registry);
  state.color = paletteValue(registry, 0, state.paletteBank);
  state.data.manifest.theme = { ...(state.data.manifest.theme || {}), color: state.color };
  markDirty({ document: true });
  syncControls(); applyAppearance(); render(); saveDraft(); savePreferences(); updateStatus();
}
function savePaletteSlot() {
  const index = $("palette-slot").value; const color = $("palette-color").value;
  if (!validColor(color, "")) return setStatus("Palette色が不正です");
  const registry = normalizeActivePaletteRegistry(); const bank = registry.banks[state.paletteBank] || registry.banks.default;
  const banks = { ...registry.banks, [state.paletteBank]: { ...bank, slots: { ...bank.slots, [index]: color } } };
  setPaletteRegistry({ ...registry, banks });
  if (index === "0") { state.color = color; state.data.manifest.theme = { ...(state.data.manifest.theme || {}), color }; applyAppearance(); }
  markDirty({ document: true }); saveDraft(); syncPaletteControls(); render(); pushHistory(); updateStatus(`Palette ${state.paletteBank}:${index} を更新しました`);
}
function bind() {
  window.addEventListener("beforeunload", event => { if (isDirty()) { event.preventDefault(); event.returnValue = ""; } });
  $("settings-toggle").addEventListener("click", () => { const open = $("settings-panel").hidden; $("settings-panel").hidden = !open; $("settings-toggle").setAttribute("aria-expanded", String(open)); document.body.classList.remove("chrome-hidden"); }); $("document-defaults-button").addEventListener("click", applyDocumentDefaults);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("settings-panel").hidden) { $("settings-panel").hidden = true; $("settings-toggle").setAttribute("aria-expanded", "false"); $("settings-toggle").focus(); } if (state.mode === "writer" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { if (event.isComposing || event.target.closest?.("input,textarea,select,#song-title") || !event.target.closest?.("#lyrics")) return; event.preventDefault(); const redo = event.shiftKey; const next = state.historyIndex + (redo ? 1 : -1); if (next >= 0 && next < state.history.length) { state.historyIndex = next; restoreSnapshot(state.history[next]); updateHistoryButtons(); } } });
  document.addEventListener("pointerdown", event => { if (!$("settings").contains(event.target) && !$("settings-panel").hidden) { $("settings-panel").hidden = true; $("settings-toggle").setAttribute("aria-expanded", "false"); } });
  $("mode-switch").addEventListener("click", () => setMode(state.mode === "writer" ? "viewer" : "writer")); $("source-mode-switch").addEventListener("click", () => setMode(state.mode === "source" ? "viewer" : "source")); $("source-editor").addEventListener("input", sourceInput);
  $("open-file-button").addEventListener("click", () => $("source-file").click()); $("source-file").addEventListener("change", () => readLocalFile($("source-file").files?.[0])); $("reload-button").addEventListener("click", reloadSource); $("reload-source-button").addEventListener("click", reloadSource); $("url-open-button").addEventListener("click", openUrlSource);
  $("variant-mode").addEventListener("change", e => { state.activeVariantId = e.target.value; render(); savePreferences(); }); $("kanji-mode").addEventListener("change", e => { state.kanji = e.target.value; render(); savePreferences(); }); $("ruby-toggle").addEventListener("change", e => { state.ruby = e.target.checked; render(); savePreferences(); }); $("vertical-toggle").addEventListener("change", e => { state.writingMode = e.target.checked ? "vertical" : "horizontal"; applyAppearance(); render(); savePreferences(); });
  $("background-color").addEventListener("input", e => { state.background = e.target.value; applyAppearance(); savePreferences(); }); $("text-color").addEventListener("input", e => { state.color = e.target.value; applyAppearance(); savePreferences(); updateStatus("表示色を変更しました"); }); $("remote-font-toggle").addEventListener("change", async e => { ++fontRequestToken; state.remoteFontsAllowed = e.target.checked; savePreferences(); try { await loadConfiguredFont(); render(); setStatus(state.remoteFontsAllowed ? "外部フォントの自動読込を許可しました" : "外部フォントの自動読込を停止しました"); } catch { render(); setStatus("外部フォントを読み込めませんでした。標準フォントを使用します"); } }); $("font-family").addEventListener("change", async e => { const token = ++fontRequestToken; const selected = e.target.value; try { await loadWebFont(selected); if (token !== fontRequestToken) return; state.font = selected; applyAppearance(); savePreferences(); setStatus("フォントを適用しました"); } catch { if (token === fontRequestToken) setStatus("フォントを読み込めませんでした"); } });
  const updateSize = value => { state.size = Math.max(14, Math.min(32, Number(value))); $("size-range").value = state.size; $("size-value").textContent = `${state.size}px`; applyAppearance(); savePreferences(); }; $("size-range").addEventListener("input", e => updateSize(e.target.value)); $("size-decrease").addEventListener("click", () => updateSize(state.size - 1)); $("size-increase").addEventListener("click", () => updateSize(state.size + 1));
  $("font-load-button").addEventListener("click", async () => { try { await loadRemoteFont($("font-url").value.trim()); setStatus("フォントを適用しました"); } catch (error) { setStatus(error instanceof Error ? error.message : "フォントを読み込めませんでした"); } });
  $("copy-all-button").addEventListener("click", () => copy(toPortableTextSafe(currentRaw(), currentAdapter()))); $("download-button").addEventListener("click", () => { download(new Blob([currentRaw()], { type: "text/plain;charset=utf-8" }), filename("txt")); updateStatus("TXTダウンロードを開始しました"); }); $("download-reader-button").addEventListener("click", () => { try { const readerText = JSON.stringify(buildReaderDocument(), null, 2); parseJsonText(readerText, "reader-document"); download(new Blob([readerText], { type: "application/json;charset=utf-8" }), filename("reader.json")); updateStatus("Reader文書ダウンロードを開始しました"); } catch (error) { setStatus(error instanceof Error ? error.message : "Reader文書が大きすぎるためダウンロードできません"); } }); $("download-container-button").addEventListener("click", () => { try { const containerText = serializeLyricContainer(buildReaderDocument(), state.activeVariantId); parseLyricContainer(containerText); download(new Blob([containerText], { type: "text/plain;charset=utf-8" }), filename("lyric.txt")); updateStatus(".lyric.txtダウンロードを開始しました"); } catch (error) { setStatus(error instanceof Error ? error.message : "Containerを保存できません"); } }); $("source-copy-button").addEventListener("click", () => { const source = state.data?.sourceUrl; if (/^https?:\/\//i.test(source || "")) copy(source); else setStatus("現在の本文にコピーできるSource URLはありません"); });
  $("share-button").addEventListener("click", () => copy(location.href)); $("undo-button").addEventListener("click", () => { if (state.historyIndex > 0) { state.historyIndex--; restoreSnapshot(state.history[state.historyIndex]); updateHistoryButtons(); } }); $("redo-button").addEventListener("click", () => { if (state.historyIndex < state.history.length - 1) { state.historyIndex++; restoreSnapshot(state.history[state.historyIndex]); updateHistoryButtons(); } });
   document.addEventListener("selectionchange", rememberSelection);
   $("lyrics").addEventListener("beforeinput", handleWysiwygBeforeInput);
  $("palette-bank").addEventListener("change", handlePaletteBankChange); $("palette-slot").addEventListener("change", syncPaletteControls); $("palette-save-button").addEventListener("click", savePaletteSlot); $("apply-palette-button").addEventListener("click", () => { const range = selectionOffsets() || state.selectionBookmark; if (!range) return setStatus("本文の範囲を選択してください"); const index = Number($("palette-slot").value); const presentation = { bank: { type: "palette-bank", name: state.paletteBank }, color: { type: "palette", index } }; const document = range.ruby ? applyRubyPresentation({ type: "document", nodes: state.nodes }, range.ruby, presentation) : applyPresentation({ type: "document", nodes: state.nodes }, range, presentation); writeBodyDocument(document, true); }); $("clear-presentation-button").addEventListener("click", () => { const range = selectionOffsets() || state.selectionBookmark; if (!range) return setStatus("本文の範囲を選択してください"); const document = range.ruby ? clearRubyPresentation({ type: "document", nodes: state.nodes }, range.ruby) : clearPresentation({ type: "document", nodes: state.nodes }, range); writeBodyDocument(document); });
  const applySelectedPresentation = presentation => { const range = selectionOffsets() || state.selectionBookmark; if (!range) return setStatus("本文の範囲を選択してください"); writeBodyDocument(range.ruby ? applyRubyPresentation({ type: "document", nodes: state.nodes }, range.ruby, presentation) : applyPresentation({ type: "document", nodes: state.nodes }, range, presentation)); };
  $("style-button").addEventListener("click", () => { const name = $("style-name").value.trim(); if (!isSafePresentationName(name)) return setStatus("Style名は予約語以外の英数字・ハイフン・アンダースコアで指定してください"); applySelectedPresentation({ style: { type: "style", name } }); });
  $("glyph-button").addEventListener("click", () => { const name = $("glyph-name").value.trim(); if (!isSafePresentationName(name)) return setStatus("Glyph名は予約語以外の英数字・ハイフン・アンダースコアで指定してください"); applySelectedPresentation({ glyph: { type: "glyph", name } }); });
  $("combine-button").addEventListener("click", () => applySelectedPresentation({ combine: { type: "combine", mode: $("combine-mode")?.value || "straight" } }));
  $("outline-button").addEventListener("click", () => { const name = $("outline-name").value.trim(); if (!isSafePresentationName(name)) return setStatus("Outline名は予約語以外の英数字・ハイフン・アンダースコアで指定してください"); applySelectedPresentation({ outline: { type: "outline", name } }); });
  $("presentation-font-button").addEventListener("click", () => { const name = $("presentation-font-name").value.trim(); if (!isSafePresentationName(name)) return setStatus("範囲Font名は予約語以外の英数字・ハイフン・アンダースコアで指定してください"); applySelectedPresentation({ font: { type: "font", name } }); });
  $("song-title").addEventListener("input", titleInput); $("lyrics").addEventListener("paste", event => { if (state.mode !== "writer") return; event.preventDefault(); const editRuby = selectionTouchesRuby(); const text = event.clipboardData?.getData("text/plain") || ""; const selection = window.getSelection(); if (!selection?.rangeCount) return; insertPastedText(selection.getRangeAt(0), text); bodyInput({ editRuby }); }); $("lyrics").addEventListener("input", bodyInput); $("lyrics").setAttribute("spellcheck", "false"); $("lyrics").setAttribute("autocorrect", "off"); $("lyrics").setAttribute("autocapitalize", "off"); $("song-title").setAttribute("spellcheck", "false"); $("song-title").setAttribute("autocorrect", "off"); $("song-title").setAttribute("autocapitalize", "off"); $("lyrics").addEventListener("copy", event => { if (!window.getSelection()?.isCollapsed) { event.preventDefault(); const range = selectionOffsets(); event.clipboardData.setData("text/plain", range ? rawText(state.nodes, range) : selectedEditedSource()); } });
  $("draft-restore").addEventListener("click", applyDraft); $("draft-discard").addEventListener("click", clearDraft);
  $("reader-shell").addEventListener("wheel", event => { if (event.target.closest(".settings") || state.writingMode !== "vertical") return; event.preventDefault(); $("reader-shell").scrollLeft -= event.deltaY || event.deltaX; }, { passive: false });
  let scrollTimer; $("reader-shell").addEventListener("scroll", () => { document.body.classList.add("is-scrolling"); document.body.classList.remove("chrome-hidden"); clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { document.body.classList.remove("is-scrolling"); document.body.classList.add("chrome-hidden"); saveScroll(); }, 900); });
  document.addEventListener("pointermove", event => { if (event.clientY < 56 || event.clientY > innerHeight - 56) document.body.classList.remove("chrome-hidden"); }, { passive: true });
  let dragDepth = 0; document.addEventListener("dragenter", e => { if (!e.dataTransfer?.types?.some(type => ["Files", "text/uri-list", "text/plain"].includes(type))) return; e.preventDefault(); dragDepth++; $("drop-overlay").hidden = false; }); document.addEventListener("dragover", e => { if (e.dataTransfer?.types?.some(type => ["Files", "text/uri-list", "text/plain"].includes(type))) e.preventDefault(); }); document.addEventListener("dragleave", e => { if (!e.dataTransfer?.types?.some(type => ["Files", "text/uri-list", "text/plain"].includes(type))) return; e.preventDefault(); if (!--dragDepth) $("drop-overlay").hidden = true; }); document.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; $("drop-overlay").hidden = true; if (e.dataTransfer?.files?.length) return readLocalFile(e.dataTransfer.files[0]); const droppedUrl = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain"); if (/^https?:\/\//i.test(droppedUrl?.trim() || "")) { $("source-url").value = droppedUrl.trim(); openUrlSource(); } });
}
async function start() { state.preferencesLoaded = restorePreferences(); applyMode(); bind(); try { const loaded = await loadInput(); loaded.manifest = validatedManifest(loaded.manifest); const nextData = normalizeDocumentData(loaded); validateLoadedVariants(nextData.manifest, nextData.variants); state.data = nextData; state.activeVariantId = normalizeActiveVariantId(normalizeVariants(state.data), state.data.activeVariantId); resetHistory(); const first = activeVariant(state.data); if (state.data.titleSource === "first-line") state.data.manifest.title = resolveTitle({ source: first.source.text }); applyManifest(state.data.manifest, state.preferencesLoaded); if (state.preferencesLoaded) { restorePreferences(); syncControls(); } let fontError = false; try { await loadConfiguredFont(); } catch { fontError = true; } applyAppearance(); render(savedScroll() || { offset: 0, top: 0, left: 0 }); setCleanCheckpoint(); showDraftIfNeeded(); updateStatus(fontError ? "外部フォントを読み込めなかったため標準フォントへ戻しました" : loaded.manifest.warnings?.length ? "一部のReader定義に警告があります。本文は継続表示しています" : undefined); pushHistory(); } catch (error) { $("reader-error").hidden = false; $("reader-error").textContent = error instanceof Error ? error.message : "読み込みに失敗しました。"; setStatus("読込失敗"); } }
bindCompositionGuards(); start();
