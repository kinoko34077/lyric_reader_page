/**
 * Real-browser audit for Reader / Writer behavior that used to be handed to a
 * human ("check it in the browser"). Every check collects DOM, Selection,
 * Clipboard, CDP Input/Performance/Accessibility evidence and reports
 * PASS / WARN / FAIL / INFO with the measured values.
 *
 * Modes:
 *   node tests/browser-audit.mjs                      deterministic local server
 *   AUDIT_URL=https://.../?mode=source node ...       audit an already served surface
 *   AUDIT_HEADED=1 node ...                           visible browser, same evidence
 *   AUDIT_OUT=dir node ...                            report / screenshot directory
 *
 * Genuine boundaries that CDP cannot establish (iOS soft keyboard, touch
 * selection handles, Safari engine specifics, screen-reader speech) are
 * reported as BOUNDARY entries instead of being delegated to a human.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { containerToReaderDocument, parseLyricContainer, serializeLyricContainer } from "../assets/js/lyric-container.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const outputRoot = path.resolve(process.env.AUDIT_OUT || path.join(os.tmpdir(), "lyric-reader-browser-audit"));
const requestedUrl = process.env.AUDIT_URL?.trim() || "";
const headed = process.env.AUDIT_HEADED === "1";
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

const FIXTURE_TITLE = "Audit Title";
const FIXTURE_BODY = "前｜読確認《よみかくにん》後[末尾:c=2]\n前〳〵後 前〴〵後\n本文";
const results = [];
function record(name, status, measured, rule = null, extra = {}) { results.push({ name, status, rule, measured, ...extra }); }

function serveLocalFile(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  let filePath = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!filePath.startsWith(root)) { response.statusCode = 403; return response.end(); }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
  if (!existsSync(filePath)) { response.statusCode = 404; return response.end(); }
  response.setHeader("content-type", contentTypes[path.extname(filePath)] || "application/octet-stream");
  createReadStream(filePath).pipe(response);
}

function containerWithSource(containerText, source) {
  const parsed = parseLyricContainer(containerText);
  const document = containerToReaderDocument(parsed);
  document.content.variants = document.content.variants.map(variant => variant.id === parsed.activeVariantId ? { ...variant, source: { text: source, url: "container:" } } : variant);
  return serializeLyricContainer(document, parsed.activeVariantId);
}

async function click(page, selector) {
  await page.evaluate(target => { document.body.classList.remove("chrome-hidden"); document.querySelector(target)?.click(); }, selector);
}

async function waitForProjectionIdle(page) {
  await page.locator("#lyrics").evaluate(root => new Promise(resolve => {
    let timer; const deadline = setTimeout(done, 10_000);
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 400); });
    function done() { observer.disconnect(); clearTimeout(timer); clearTimeout(deadline); resolve(); }
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    timer = setTimeout(done, 400);
  }));
}

async function mode(page) { return page.evaluate(() => document.body.dataset.mode); }
async function toSource(page) { if (await mode(page) !== "source") await click(page, "#source-mode-switch"); await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 }); }
async function toWriter(page) { if (await mode(page) === "source") await click(page, "#source-mode-switch"); if (await mode(page) !== "writer") await click(page, "#mode-switch"); await page.waitForFunction(() => document.body.dataset.mode === "writer"); await waitForProjectionIdle(page); }
async function toViewer(page) { if (await mode(page) === "source") await click(page, "#source-mode-switch"); if (await mode(page) === "writer") await click(page, "#mode-switch"); await page.waitForFunction(() => document.body.dataset.mode === "viewer"); await waitForProjectionIdle(page); }
async function readBody(page) { await toSource(page); return parseLyricContainer(await page.locator("#source-editor").inputValue()).source; }

async function loadFixture(page, baseContainer, body = `${FIXTURE_TITLE}\n${FIXTURE_BODY}`) {
  await toSource(page);
  const container = containerWithSource(baseContainer, body);
  await page.locator("#source-editor").fill(container);
  await page.waitForFunction(value => document.querySelector("#source-editor")?.value === value && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", container, { timeout: 30_000 });
}

/** Place a collapsed caret after `text` (or at its start) inside `rootSelector`, joining text nodes like a user would see them. */
async function placeCaret(page, rootSelector, text, { atStart = false, occurrence = "first" } = {}) {
  return page.evaluate(({ rootSelector, text, atStart, occurrence }) => {
    const root = document.querySelector(rootSelector); if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement?.closest("rt") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const joined = nodes.map(node => node.nodeValue || "").join("");
    const index = occurrence === "last" ? joined.lastIndexOf(text) : joined.indexOf(text); if (index < 0) return false;
    let target = atStart ? index : index + text.length; let cursor = 0;
    for (const node of nodes) {
      const length = (node.nodeValue || "").length;
      if (atStart ? target < cursor + length : target <= cursor + length) { const range = document.createRange(); range.setStart(node, target - cursor); range.collapse(true); document.querySelector("#writer-surface")?.focus({ preventScroll: true }); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; }
      cursor += length;
    }
    return false;
  }, { rootSelector, text, atStart, occurrence });
}

async function scrollState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector("#reader-shell"); const selection = getSelection();
    let caret = null; if (selection?.rangeCount) { const rect = selection.getRangeAt(0).getClientRects()[0] || selection.getRangeAt(0).startContainer.parentElement?.getBoundingClientRect(); if (rect) caret = { top: Math.round(rect.top), left: Math.round(rect.left), bottom: Math.round(rect.bottom) }; }
    return { windowY: Math.round(scrollY), windowX: Math.round(scrollX), shellTop: Math.round(shell?.scrollTop || 0), shellLeft: Math.round(shell?.scrollLeft || 0), caret, viewport: { width: innerWidth, height: innerHeight } };
  });
}

async function imeCommit(page, cdp, text) {
  // CDP drives the browser IME pipeline (compositionstart/update/end + beforeinput/input) rather than synthetic DOM events.
  await cdp.send("Input.imeSetComposition", { text: text.slice(0, 1), selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  await cdp.send("Input.insertText", { text });
  await page.waitForTimeout(150);
  await waitForProjectionIdle(page);
}

async function auditIme(page, cdp, baseContainer) {
  const cases = [
    { name: "ime.title-end", root: "#song-title", after: FIXTURE_TITLE, expect: body => body.startsWith(`${FIXTURE_TITLE}かな\n`) },
    { name: "ime.after-ruby", root: "#lyrics", after: "後", atStart: true, expect: body => body.includes("｜読確認《よみかくにん》かな後") },
    { name: "ime.after-presentation", root: "#lyrics", after: "末尾", expect: body => body.includes("[末尾:c=2]かな\n") || body.includes("[末尾かな:c=2]\n") },
    { name: "ime.body-end", root: "#lyrics", after: "本文", occurrence: "last", expect: body => body.endsWith("本文かな") }
  ];
  for (const item of cases) {
    try {
      await loadFixture(page, baseContainer); await toWriter(page);
      if (!await placeCaret(page, item.root, item.after, { occurrence: item.occurrence, atStart: item.atStart })) throw new Error(`caret target not found: ${item.after}`);
      const before = await scrollState(page);
      await imeCommit(page, cdp, "かな");
      const after = await scrollState(page);
      const projectedCount = await page.evaluate(() => { const clone = document.querySelector("#writer-surface").cloneNode(true); clone.querySelectorAll("rt").forEach(node => node.remove()); return (clone.textContent.match(/かな/g) || []).length; });
      const body = await readBody(page);
      const scrollJump = Math.abs(after.windowY - before.windowY) + Math.abs(after.shellTop - before.shellTop) + Math.abs(after.shellLeft - before.shellLeft);
      const caretVisible = !after.caret || (after.caret.top >= 0 && after.caret.bottom <= after.viewport.height);
      const ok = item.expect(body) && projectedCount === 1;
      record(item.name, ok && scrollJump === 0 ? "PASS" : ok ? "WARN" : "FAIL", { source: body, projectedCommitCount: projectedCount, scrollJumpPx: scrollJump, caretVisible, before, after }, "CDP IME commit lands once at the caret's Source offset, the projection shows it exactly once, scroll offsets unchanged");
    } catch (error) { record(item.name, "FAIL", null, null, { error: String(error?.message || error) }); }
  }
}

async function auditTyping(page, cdp, baseContainer) {
  try {
    await loadFixture(page, baseContainer); await toWriter(page);
    await placeCaret(page, "#lyrics", "本文", { occurrence: "last" });
    await page.evaluate(() => { window.__auditLongTasks = []; try { new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__auditLongTasks.push(entry.duration); }).observe({ type: "longtask" }); } catch { window.__auditLongTasks = null; } });
    const metricsBefore = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
    const before = await scrollState(page);
    const typed = "あいうえおかきくけこさしすせそ";
    const latencies = [];
    for (const unit of typed) { const start = Date.now(); await page.keyboard.insertText(unit); latencies.push(Date.now() - start); }
    await waitForProjectionIdle(page);
    const after = await scrollState(page);
    const metricsAfter = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
    const longTasks = await page.evaluate(() => window.__auditLongTasks);
    const body = await readBody(page);
    const ok = body.endsWith(`本文${typed}`);
    const scrollJump = Math.abs(after.windowY - before.windowY) + Math.abs(after.shellTop - before.shellTop);
    record("writer.continuous-typing", ok && scrollJump === 0 ? "PASS" : ok ? "WARN" : "FAIL", { typedUnits: typed.length, sourceTail: body.slice(-30), scrollJumpPx: scrollJump, before, after }, "each insertText lands at the advancing caret; no scroll jump during input");
    const sorted = [...latencies].sort((a, b) => a - b);
    record("perf.typing-latency", "INFO", { unitMs: { median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) }, longTasks: longTasks ? { count: longTasks.length, maxMs: Math.round(Math.max(0, ...longTasks)), totalMs: Math.round(longTasks.reduce((a, b) => a + b, 0)) } : "unsupported", layoutCount: metricsAfter.LayoutCount - metricsBefore.LayoutCount, recalcStyleCount: metricsAfter.RecalcStyleCount - metricsBefore.RecalcStyleCount, domNodesDelta: metricsAfter.Nodes - metricsBefore.Nodes, jsHeapUsedDeltaKB: Math.round((metricsAfter.JSHeapUsedSize - metricsBefore.JSHeapUsedSize) / 1024) }, "informational: the project defines no latency budget");
  } catch (error) { record("writer.continuous-typing", "FAIL", null, null, { error: String(error?.message || error) }); }
}

async function auditBoundary(page, baseContainer) {
  try {
    await loadFixture(page, baseContainer); await toWriter(page);
    await placeCaret(page, "#song-title", FIXTURE_TITLE);
    await page.keyboard.press("Enter"); await waitForProjectionIdle(page);
    const afterEnter = await readBody(page);
    await toWriter(page);
    await placeCaret(page, "#lyrics", "", { atStart: true });
    await page.keyboard.press("Backspace"); await waitForProjectionIdle(page);
    const afterBackspace = await readBody(page);
    const enterOk = afterEnter.startsWith(`${FIXTURE_TITLE}\n\n`) || afterEnter.startsWith(`${FIXTURE_TITLE}\n\n前`);
    record("writer.title-body-boundary", enterOk ? "PASS" : "FAIL", { afterEnter: afterEnter.slice(0, 40), afterBackspace: afterBackspace.slice(0, 40) }, "real Enter at Title end inserts a Source line break");
  } catch (error) { record("writer.title-body-boundary", "FAIL", null, null, { error: String(error?.message || error) }); }
}

async function selectTextAndRerender(page, rootSelector, text) {
  // Text-node offsets (as a user drag produces) across a real re-render (Palette bank change triggers render()).
  const selected = await page.evaluate(({ rootSelector, text }) => {
    const root = document.querySelector(rootSelector); const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const node = walker.currentNode; const index = node.nodeValue.indexOf(text); if (index < 0) continue; const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + text.length); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); }
    return "";
  }, { rootSelector, text });
  const rerendered = await page.evaluate(() => { const bank = document.querySelector("#palette-bank"); const values = [...bank.options].map(option => option.value); const next = values.find(value => value !== bank.value); if (!next) return false; bank.value = next; bank.dispatchEvent(new Event("change", { bubbles: true })); return true; });
  await page.waitForTimeout(300);
  return { selected, retained: await page.evaluate(() => getSelection().toString()), rerendered };
}

async function auditSelectionAndClipboard(page, baseContainer) {
  // Selection must survive a routine late render, and native Ctrl+C must reach the OS clipboard as Portable / Author text.
  try {
    await loadFixture(page, baseContainer); await toViewer(page);
    const selected = await page.evaluate(() => { const ruby = document.querySelector("#lyrics .source-ruby"); if (!ruby) return ""; const range = document.createRange(); range.selectNode(ruby); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); });
    await page.waitForTimeout(600);
    const retained = await page.evaluate(() => getSelection().toString());
    const viewerRerender = await selectTextAndRerender(page, "#lyrics", "本文");
    record("viewer.selection-retention", selected && retained === selected && viewerRerender.rerendered && viewerRerender.retained === viewerRerender.selected ? "PASS" : "FAIL", { lateRender: { selected, retained }, textOffsetRerender: viewerRerender }, "selection text unchanged across a late Font render and an explicit re-render");
    await page.evaluate(() => { const lyrics = document.querySelector("#lyrics"); const walker = document.createTreeWalker(lyrics, NodeFilter.SHOW_TEXT); let end = null; while (walker.nextNode()) if (walker.currentNode.nodeValue.includes("末尾")) { end = walker.currentNode; break; } const range = document.createRange(); range.setStart(lyrics, 0); range.setEnd(end, end.nodeValue.indexOf("末尾") + 2); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.keyboard.press("Control+C"); await page.waitForTimeout(200);
    const viewerClipboard = await page.evaluate(() => navigator.clipboard.readText().catch(error => `ERROR ${error}`));
    record("viewer.native-copy", viewerClipboard === "前｜読確認《よみかくにん》後末尾" ? "PASS" : "FAIL", { clipboard: viewerClipboard, expected: "前｜読確認《よみかくにん》後末尾" }, "native copy of a line with Ruby and Presentation yields Portable Text (Ruby kept, Presentation removed)");

    await toWriter(page);
    const writerRerender = await selectTextAndRerender(page, "#song-title", FIXTURE_TITLE);
    record("writer.selection-retention", writerRerender.rerendered && writerRerender.selected && writerRerender.retained === writerRerender.selected ? "PASS" : "FAIL", writerRerender, "a Title text selection survives an unrelated re-render");
    await page.evaluate(() => { const ruby = document.querySelector("#lyrics .source-ruby"); const range = document.createRange(); range.selectNode(ruby); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.querySelector("#writer-surface").focus({ preventScroll: true }); });
    await page.keyboard.press("Control+C"); await page.waitForTimeout(200);
    const writerClipboard = await page.evaluate(() => navigator.clipboard.readText().catch(error => `ERROR ${error}`));
    record("writer.native-copy", writerClipboard.includes("読確認《よみかくにん》") ? "PASS" : "FAIL", { clipboard: writerClipboard }, "Writer copy yields the Author Source range");

    await placeCaret(page, "#lyrics", "本文", { occurrence: "last" });
    await page.keyboard.press("Control+V"); await page.waitForTimeout(200); await waitForProjectionIdle(page);
    const pasted = await readBody(page);
    record("writer.native-paste", /本文｜?読確認《よみかくにん》$/.test(pasted) ? "PASS" : "FAIL", { sourceTail: pasted.slice(-30) }, "native paste inserts clipboard text into Source; shared Parser recognises Ruby");
  } catch (error) { record("clipboard", "FAIL", null, null, { error: String(error?.message || error) }); }
}

async function auditTypography(page, baseContainer) {
  try {
    await loadFixture(page, baseContainer); await toViewer(page);
    const sizes = [];
    for (const size of [14, 20, 32]) {
      await page.evaluate(value => { const select = document.querySelector("#size-select"); select.value = String(value); select.dispatchEvent(new Event("change", { bubbles: true })); select.dispatchEvent(new Event("input", { bubbles: true })); }, size);
      await waitForProjectionIdle(page);
      sizes.push(await page.evaluate(requested => {
        const px = element => element ? parseFloat(getComputedStyle(element).fontSize) : null;
        const base = document.querySelector("#lyrics .ruby-base-part"); const rt = document.querySelector("#lyrics rt"); const text = document.querySelector("#lyrics .source-text");
        return { requested, body: px(text), rubyBase: px(base), reading: px(rt), readingRatio: rt && base ? Math.round(px(rt) / px(base) * 1000) / 1000 : null };
      }, size));
    }
    const ratios = new Set(sizes.map(entry => entry.readingRatio));
    const ok = sizes.every(entry => entry.body === entry.requested && entry.rubyBase === entry.requested) && ratios.size === 1;
    record("typography.ruby-relative-size", ok ? "PASS" : "FAIL", sizes, "body and Ruby base equal the requested size; reading keeps one ratio to the base");

    await page.evaluate(() => { const toggle = document.querySelector("#vertical-toggle"); if (!toggle.checked) toggle.click(); });
    await waitForProjectionIdle(page);
    const marks = await page.evaluate(() => [...document.querySelectorAll("#lyrics .repeat-mark-pair")].map(mark => {
      const rect = mark.getBoundingClientRect(); const fontSize = parseFloat(getComputedStyle(mark).fontSize);
      const edgeBox = (node, last) => { if (node?.nodeType !== Node.TEXT_NODE || !node.nodeValue) return null; const range = document.createRange(); const at = last ? node.nodeValue.length - 1 : 0; range.setStart(node, at); range.setEnd(node, at + 1); const box = range.getBoundingClientRect(); return box.height ? { top: box.top, bottom: box.bottom } : null; };
      const neighbours = [edgeBox(mark.previousSibling, true), edgeBox(mark.nextSibling, false)];
      const overlaps = neighbours.filter(Boolean).some(box => box.bottom > rect.top + 0.5 && box.top < rect.bottom - 0.5);
      return { text: mark.textContent, advancePx: Math.round(rect.height * 10) / 10, fontSize, advanceEm: Math.round(rect.height / fontSize * 100) / 100, overlaps };
    }));
    const marksOk = marks.length >= 2 && marks.every(mark => mark.advanceEm >= 1.9 && mark.advanceEm <= 2.1 && !mark.overlaps);
    record("vertical.repeat-mark-advance", marksOk ? "PASS" : "FAIL", marks, "each 〳〵 / 〴〵 occupies 2em ±0.1 of vertical advance and does not overlap its neighbours");
    await page.evaluate(() => { const toggle = document.querySelector("#vertical-toggle"); if (toggle.checked) toggle.click(); });
  } catch (error) { record("typography", "FAIL", null, null, { error: String(error?.message || error) }); }
}

async function auditFonts(page) {
  try {
    const state = await page.evaluate(() => {
      const options = [...document.querySelectorAll("#font-family option")].map(option => ({ value: option.value, disabled: option.disabled, label: option.textContent }));
      const nishiki = options.find(option => /nishiki/i.test(option.value));
      const loaded = [...document.fonts].filter(face => face.status === "loaded").map(face => face.family);
      const context = document.createElement("canvas").getContext("2d"); const sample = "晴々撥条〳〵永ABCmwil";
      const widths = ["serif", "monospace"].map(fallback => { context.font = `32px ${fallback}`; const base = context.measureText(sample).width; context.font = `32px "Nishiki-teki", ${fallback}`; return { fallback, base, withNishiki: context.measureText(sample).width }; });
      const rendersDistinctFace = loaded.some(family => /nishiki/i.test(family)) || widths.some(entry => Math.abs(entry.withNishiki - entry.base) > 0.5);
      return { nishiki, loadedFamilies: loaded, widths, rendersDistinctFace, fontsCheckForUnknownFamily: document.fonts.check('1em "NoSuchFamily-Audit"') };
    });
    const honest = !state.nishiki || state.nishiki.disabled === !state.rendersDistinctFace;
    record("font.nishiki-availability", honest ? "PASS" : "FAIL", state, "Nishiki-teki is selectable exactly when a real face measurably changes glyph advances");
  } catch (error) { record("font.nishiki-availability", "FAIL", null, null, { error: String(error?.message || error) }); }
}

async function auditGeometry(browser, targetUrl, baseContainer) {
  const viewports = [{ name: "phone-360", width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, { name: "desktop-1280", width: 1280, height: 800 }];
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: Boolean(viewport.isMobile), hasTouch: Boolean(viewport.hasTouch), deviceScaleFactor: viewport.deviceScaleFactor || 1, locale: "ja-JP" });
    const page = await context.newPage();
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (document.querySelector("#source-editor")?.value || "").length > 100, null, { timeout: 30_000 });
      await loadFixture(page, baseContainer);
      for (const surface of ["viewer", "writer"]) {
        for (const vertical of [false, true]) {
          if (surface === "viewer") await toViewer(page); else await toWriter(page);
          await page.evaluate(want => { const toggle = document.querySelector("#vertical-toggle"); if (toggle.checked !== want) toggle.click(); document.body.classList.remove("chrome-hidden"); }, vertical);
          await waitForProjectionIdle(page);
          const geometry = await page.evaluate(() => {
            const doc = document.documentElement; const clipped = [];
            for (const control of document.querySelectorAll("#site-header button, #site-header select")) {
              const style = getComputedStyle(control); if (style.display === "none" || style.visibility === "hidden" || control.closest("[hidden]")) continue;
              const rect = control.getBoundingClientRect(); if (!rect.width) continue;
              if (rect.left < -0.5 || rect.right > innerWidth + 0.5) clipped.push({ id: control.id, left: Math.round(rect.left), right: Math.round(rect.right) });
            }
            return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth > doc.clientWidth, clippedControls: clipped };
          });
          const name = `geometry.${viewport.name}.${surface}.${vertical ? "vertical" : "horizontal"}`;
          record(name, !geometry.overflow && geometry.clippedControls.length === 0 ? "PASS" : "FAIL", geometry, "document has no horizontal overflow; header controls stay inside the viewport");
        }
      }
      const shot = path.join(outputRoot, `${viewport.name}-writer-vertical.png`);
      await page.screenshot({ path: shot }); results.at(-1).screenshot = shot;
      await page.evaluate(() => { const toggle = document.querySelector("#vertical-toggle"); if (toggle.checked) toggle.click(); });
    } catch (error) { record(`geometry.${viewport.name}`, "FAIL", null, null, { error: String(error?.message || error) }); }
    finally { await context.close(); }
  }
}

async function auditAccessibility(page, cdp) {
  try {
    await cdp.send("Accessibility.enable");
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const interactive = new Set(["button", "combobox", "checkbox", "textbox", "slider", "spinbutton", "link", "menuitem", "switch"]);
    const unnamed = nodes.filter(node => !node.ignored && interactive.has(node.role?.value) && !String(node.name?.value || "").trim()).map(node => ({ role: node.role.value, backendDOMNodeId: node.backendDOMNodeId }));
    const describe = async backendNodeId => (await cdp.send("DOM.describeNode", { backendNodeId }).catch(() => null))?.node?.attributes || [];
    for (const item of unnamed) item.attributes = await describe(item.backendDOMNodeId);
    record("a11y.control-names", unnamed.length === 0 ? "PASS" : "FAIL", { interactiveCount: nodes.filter(node => !node.ignored && interactive.has(node.role?.value)).length, unnamed }, "every exposed interactive control has an accessible name");
    const writer = await page.evaluate(() => { const surface = document.querySelector("#writer-surface"); const status = document.querySelector("#source-status"); return { writerLabel: surface?.getAttribute("aria-label"), statusRole: status?.getAttribute("role"), statusLive: status?.getAttribute("aria-live") }; });
    record("a11y.semantics", writer.writerLabel && (writer.statusRole === "status" || writer.statusLive) ? "PASS" : "WARN", writer, "Writer surface is labelled; status region exposes status/live semantics");
  } catch (error) { record("a11y", "FAIL", null, null, { error: String(error?.message || error) }); }
}

const local = requestedUrl ? null : await new Promise((resolve, reject) => { const server = createServer(serveLocalFile); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server)); });
const targetUrl = requestedUrl || `http://127.0.0.1:${local.address().port}/?mode=source`;
await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: !headed });
const startedAt = new Date().toISOString();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ja-JP" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(targetUrl).origin });
  const page = await context.newPage();
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(String(error)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(targetUrl, { waitUntil: "load" });
  await page.waitForFunction(() => (document.querySelector("#source-editor")?.value || "").length > 100, null, { timeout: 30_000 });
  const navigation = await page.evaluate(() => { const entry = performance.getEntriesByType("navigation")[0]; return entry ? { domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd), loadMs: Math.round(entry.loadEventEnd), transferKB: Math.round(entry.transferSize / 1024) } : null; });
  record("perf.navigation", "INFO", navigation, "informational: the project defines no load budget");
  const baseContainer = await page.locator("#source-editor").inputValue();

  await auditIme(page, cdp, baseContainer);
  await auditTyping(page, cdp, baseContainer);
  await auditBoundary(page, baseContainer);
  await auditSelectionAndClipboard(page, baseContainer);
  await auditTypography(page, baseContainer);
  await auditFonts(page);
  await auditAccessibility(page, cdp);
  record("runtime.page-errors", pageErrors.length ? "FAIL" : "PASS", pageErrors, "no uncaught page errors during the audit");
  await context.close();
  await auditGeometry(browser, targetUrl, baseContainer);
} finally {
  await browser.close();
  if (local) await new Promise(resolve => local.close(resolve));
}

const boundaries = [
  "iOS soft keyboard and native caret tracking in real Safari (CDP drives Chromium's IME pipeline, not iOS keyboards)",
  "touch selection handles and the iOS edit menu",
  "WebKit engine specifics beyond the Playwright WebKit emulation gate",
  "spoken screen-reader output (the accessibility tree is verified, speech is not)"
];
const summary = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
for (const result of results) summary[result.status] += 1;
const report = { url: targetUrl, browser: `chromium ${browser.version?.() || ""}`.trim(), headed, startedAt, finishedAt: new Date().toISOString(), summary, results, boundaries };
const reportPath = path.join(outputRoot, "browser-audit.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
for (const result of results) console.log(`${result.status.padEnd(4)} ${result.name}${result.error ? ` — ${result.error}` : ""}`);
for (const boundary of boundaries) console.log(`BOUNDARY ${boundary}`);
console.log(`summary PASS=${summary.PASS} WARN=${summary.WARN} FAIL=${summary.FAIL} INFO=${summary.INFO} report=${reportPath}`);
if (summary.FAIL) process.exitCode = 1;
