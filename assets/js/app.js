import { loadInput } from "./data-loader.js";
import { parseRuby } from "./ruby-parser.js";
import { renderLyrics, rawText } from "./reader-view.js";

const $ = id => document.getElementById(id);
const state = { kana: "historical", kanji: "original", ruby: true, writingMode: "horizontal", size: 20, data: null, nodes: [] };

function safeLink(value) { try { const url = new URL(value, location.href); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function applyManifest(manifest) {
  const defaults = manifest.defaults || manifest.theme?.defaults || {};
  state.kana = defaults.kana === "modern" ? "modern" : "historical"; state.kanji = defaults.kanji === "shinjitai" ? "shinjitai" : "original";
  state.ruby = defaults.ruby !== false; state.writingMode = defaults.writingMode === "vertical" ? "vertical" : "horizontal";
  $("kana-mode").value = state.kana; $("kanji-mode").value = state.kanji; $("ruby-toggle").checked = state.ruby; $("vertical-toggle").checked = state.writingMode === "vertical";
  $("song-title").textContent = String(manifest.title || "無題"); $("song-artist").textContent = String(manifest.artist || ""); $("song-description").textContent = String(manifest.description || "");
  const links = $("song-links"); links.replaceChildren(); for (const [label, value] of Object.entries(manifest.links || {})) { const href = safeLink(value); if (!href) continue; const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label; links.append(a); }
}
function currentSource() { return state.kana === "modern" ? state.data.modern.text : state.data.historical.text; }
function render() { state.nodes = renderLyrics($("lyrics"), currentSource(), state); }
function setStatus(text) { $("source-status").textContent = text; }
function bind() {
  $("settings-toggle").addEventListener("click", () => { const open = $("settings-panel").hidden; $("settings-panel").hidden = !open; $("settings-toggle").setAttribute("aria-expanded", String(open)); });
  $("kana-mode").addEventListener("change", e => { state.kana = e.target.value; render(); }); $("kanji-mode").addEventListener("change", e => { state.kanji = e.target.value; render(); });
  $("ruby-toggle").addEventListener("change", e => { state.ruby = e.target.checked; render(); }); $("vertical-toggle").addEventListener("change", e => { state.writingMode = e.target.checked ? "vertical" : "horizontal"; render(); });
  const updateSize = value => { state.size = Math.max(14, Math.min(32, Number(value))); $("size-range").value = state.size; $("size-value").textContent = `${state.size}px`; document.documentElement.style.setProperty("--reader-size", `${state.size}px`); };
  $("size-range").addEventListener("input", e => updateSize(e.target.value)); $("size-decrease").addEventListener("click", () => updateSize(state.size - 1)); $("size-increase").addEventListener("click", () => updateSize(state.size + 1));
  $("copy-button").addEventListener("click", async () => { await navigator.clipboard.writeText(rawText(state.nodes)); setStatus("原文記法をコピーしました"); setTimeout(() => setStatus("読み込み済み"), 1800); });
  $("download-button").addEventListener("click", () => { const blob = new Blob([rawText(state.nodes)], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "lyrics.txt"; a.click(); URL.revokeObjectURL(a.href); });
  let timer; $("lyrics").addEventListener("scroll", () => { document.body.classList.add("is-scrolling"); clearTimeout(timer); timer = setTimeout(() => document.body.classList.remove("is-scrolling"), 450); }, { passive: true });
}
async function start() { bind(); try { state.data = await loadInput(); applyManifest(state.data.manifest); render(); setStatus("読み込み済み"); } catch (error) { $("reader-error").hidden = false; $("reader-error").textContent = error instanceof Error ? error.message : "読み込みに失敗しました。"; setStatus("読み込み失敗"); } }
start();
