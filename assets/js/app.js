import { loadInput } from "./data-loader.js";
import { parseRuby } from "./ruby-parser.js";
import { renderLyrics, rawText } from "./reader-view.js";

const $ = id => document.getElementById(id);
const state = { kana: "historical", kanji: "original", ruby: true, writingMode: "horizontal", size: 20, font: "serif", fontUrl: "", background: "#f5f0e6", color: "#272522", rubyColor: "#716b60", data: null, nodes: [] };

const FONT_STACKS = {
  serif: '"Noto Serif JP", "Yu Mincho", YuMincho, serif',
  sans: '"Noto Sans JP", "Yu Gothic", YuGothic, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  "yu-mincho": '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", serif',
  "noto-serif": '"Noto Serif JP", "Yu Mincho", YuMincho, serif',
  "noto-sans": '"Noto Sans JP", "Yu Gothic", YuGothic, sans-serif',
  "nishiki-teki": '"Nishiki-teki", "Noto Serif JP", "Yu Mincho", serif'
};

function safeLink(value) { try { const url = new URL(value, location.href); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function applyManifest(manifest) {
  const defaults = manifest.defaults || manifest.theme?.defaults || {};
  state.kana = defaults.kana === "modern" ? "modern" : "historical"; state.kanji = defaults.kanji === "shinjitai" ? "shinjitai" : "original";
  state.ruby = defaults.ruby !== false; state.writingMode = defaults.writingMode === "vertical" ? "vertical" : "horizontal";
  const theme = manifest.theme || {};
  state.font = theme.font?.type === "remote" ? "custom" : (theme.font?.id || theme.font || "serif");
  state.fontUrl = theme.font?.type === "remote" ? String(theme.font.url || "") : "";
  state.background = validColor(theme.background, state.background); state.color = validColor(theme.color, state.color); state.rubyColor = validColor(theme.rubyColor, state.rubyColor);
  $("kana-mode").value = state.kana; $("kanji-mode").value = state.kanji; $("ruby-toggle").checked = state.ruby; $("vertical-toggle").checked = state.writingMode === "vertical";
  $("font-family").value = state.font === "custom" || FONT_STACKS[state.font] ? state.font : "serif"; $("font-url").value = state.fontUrl;
  $("background-color").value = state.background; $("text-color").value = state.color; $("ruby-color").value = state.rubyColor;
  $("song-title").textContent = String(manifest.title || "無題"); $("song-artist").textContent = String(manifest.artist || ""); $("song-description").textContent = String(manifest.description || "");
  const links = $("song-links"); links.replaceChildren(); for (const [label, value] of Object.entries(manifest.links || {})) { const href = safeLink(value); if (!href) continue; const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label; links.append(a); }
}
function validColor(value, fallback) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback; }
function applyAppearance() { const font = state.font === "custom" ? '"ReaderCustom", serif' : (FONT_STACKS[state.font] || FONT_STACKS.serif); document.documentElement.style.setProperty("--paper", state.background); document.documentElement.style.setProperty("--ink", state.color); document.documentElement.style.setProperty("--ruby", state.rubyColor); document.documentElement.style.setProperty("--reader-font", font); document.querySelector(".reader-shell").classList.toggle("is-vertical", state.writingMode === "vertical"); }
async function loadRemoteFont(url) { if (!/^https?:\/\//i.test(url)) throw new Error("HTTP(S)のフォントURLのみ指定できます。"); const face = new FontFace("ReaderCustom", `url(${JSON.stringify(url)})`); await face.load(); document.fonts.add(face); state.font = "custom"; state.fontUrl = url; applyAppearance(); }
function currentSource() { return state.kana === "modern" ? state.data.modern.text : state.data.historical.text; }
function render() { state.nodes = renderLyrics($("lyrics"), currentSource(), state); }
function setStatus(text) { $("source-status").textContent = text; }
function setLocalSource(text, name = "ローカル本文") { state.data = { manifest: { title: name.replace(/\.txt$/i, "") || "ローカル本文", description: "この本文はブラウザ内だけで読み込んでいます。", content: { format: "narou" } }, historical: { text, url: "local:" }, modern: { text, url: "local:" } }; applyManifest(state.data.manifest); applyAppearance(); render(); setStatus("ローカル本文を表示中"); }
async function readLocalFile(file) { if (!file) return; setLocalSource(await file.text(), file.name); }
function buildReaderDocument() { return { version: 1, content: { text: currentSource(), format: "narou-text" }, meta: { title: $("song-title").textContent, artist: $("song-artist").textContent, description: $("song-description").textContent }, theme: { font: state.font === "custom" ? { type: "remote", url: state.fontUrl } : state.font, background: state.background, color: state.color, rubyColor: state.rubyColor }, defaults: { kana: state.kana, kanji: state.kanji, ruby: state.ruby, writingMode: state.writingMode }, links: Object.fromEntries([...$("song-links").querySelectorAll("a")].map(link => [link.textContent, link.href])) }; }
function setReaderDocument(documentData, name = "Reader文書") { const content = documentData?.content?.text; if (typeof content !== "string") throw new Error("Reader文書に本文がありません。"); const manifest = { ...(documentData.meta || {}), title: documentData.meta?.title || "Reader文書", content: { format: documentData.content.format || "narou-text" }, defaults: documentData.defaults || {}, theme: documentData.theme || {}, links: documentData.links || {} }; state.data = { manifest, historical: { text: content, url: "reader:" }, modern: { text: content, url: "reader:" } }; applyManifest(manifest); applyAppearance(); render(); setStatus(`${name}を読み込みました`); }
function bind() {
  $("settings-toggle").addEventListener("click", () => { const open = $("settings-panel").hidden; $("settings-panel").hidden = !open; $("settings-toggle").setAttribute("aria-expanded", String(open)); });
  $("kana-mode").addEventListener("change", e => { state.kana = e.target.value; render(); }); $("kanji-mode").addEventListener("change", e => { state.kanji = e.target.value; render(); });
  $("ruby-toggle").addEventListener("change", e => { state.ruby = e.target.checked; render(); }); $("vertical-toggle").addEventListener("change", e => { state.writingMode = e.target.checked ? "vertical" : "horizontal"; applyAppearance(); render(); });
  $("background-color").addEventListener("input", e => { state.background = e.target.value; applyAppearance(); }); $("text-color").addEventListener("input", e => { state.color = e.target.value; applyAppearance(); }); $("ruby-color").addEventListener("input", e => { state.rubyColor = e.target.value; applyAppearance(); });
  $("font-family").addEventListener("change", e => { state.font = e.target.value; applyAppearance(); });
  $("font-load-button").addEventListener("click", async () => { const value = $("font-url").value.trim(); try { await loadRemoteFont(value); setStatus("外部フォントを適用しました"); } catch { setStatus("外部フォントを読み込めませんでした"); } });
  const updateSize = value => { state.size = Math.max(14, Math.min(32, Number(value))); $("size-range").value = state.size; $("size-value").textContent = `${state.size}px`; document.documentElement.style.setProperty("--reader-size", `${state.size}px`); };
  $("size-range").addEventListener("input", e => updateSize(e.target.value)); $("size-decrease").addEventListener("click", () => updateSize(state.size - 1)); $("size-increase").addEventListener("click", () => updateSize(state.size + 1));
  $("copy-button").addEventListener("click", async () => { await navigator.clipboard.writeText(rawText(state.nodes)); setStatus("原文記法をコピーしました"); setTimeout(() => setStatus("読み込み済み"), 1800); });
  $("download-button").addEventListener("click", () => { const blob = new Blob([rawText(state.nodes)], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lyrics.txt"; a.click(); URL.revokeObjectURL(a.href); });
  $("download-reader-button").addEventListener("click", () => { const blob = new Blob([JSON.stringify(buildReaderDocument(), null, 2)], { type: "application/json;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "reader.reader.json"; a.click(); URL.revokeObjectURL(a.href); });
  const dropZone = $("drop-zone"); const sourceFile = $("source-file"); sourceFile.addEventListener("change", () => readLocalFile(sourceFile.files?.[0]));
  $("reader-file").addEventListener("change", async () => { const file = $("reader-file").files?.[0]; if (!file) return; try { setReaderDocument(JSON.parse(await file.text()), file.name); } catch (error) { setStatus(error instanceof Error ? error.message : "Reader文書を読み込めませんでした"); } });
  ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add("is-dragover"); })); ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove("is-dragover"); })); dropZone.addEventListener("drop", event => readLocalFile(event.dataTransfer.files?.[0]));
  $("source-text-button").addEventListener("click", () => { const text = $("source-text").value; if (text.trim()) setLocalSource(text); });
  let timer; $("lyrics").addEventListener("scroll", () => { document.body.classList.add("is-scrolling"); clearTimeout(timer); timer = setTimeout(() => document.body.classList.remove("is-scrolling"), 450); }, { passive: true });
}
async function start() { bind(); try { state.data = await loadInput(); applyManifest(state.data.manifest); applyAppearance(); if (state.font === "custom" && state.fontUrl) await loadRemoteFont(state.fontUrl); render(); setStatus("読み込み済み"); } catch (error) { $("reader-error").hidden = false; $("reader-error").textContent = error instanceof Error ? error.message : "読み込みに失敗しました。"; setStatus("読み込み失敗"); } }
start();
