import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { getSyntaxAdapter, parseSource, toPortableText } from "../assets/js/syntax-adapter.js";
import { containerToReaderDocument, parseLyricContainer, serializeLyricContainer } from "../assets/js/lyric-container.js";
import { runWriterGateSuite } from "./writer-gate-runner.mjs";

const root = path.resolve(process.cwd());
const outputRoot = process.env.WRITER_GATE_OUTPUT || path.join(os.tmpdir(), "lyric-reader-writer-gate");
const requestedUrl = process.env.WRITER_GATE_URL?.trim();
const canonicalAdapter = getSyntaxAdapter("narou-text");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function serveLocalFile(request, response) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1/").pathname); } catch { response.writeHead(400); response.end("Bad URL"); return; }
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end("Forbidden"); return; }
  if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}

async function startLocalServer() {
  const server = createServer(serveLocalFile);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/?mode=source` };
}

function expectedAssetFailure(url) {
  return /invalid\.example|missing-glyph\.svg|missing-reader\.txt/.test(url);
}

async function clickHeaderButton(page, selector) {
  await page.evaluate(target => { document.body.classList.remove("chrome-hidden"); document.querySelector(target)?.click(); }, selector);
}

async function selectTextInRoot(locator, text) {
  return locator.evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const source = nodes.map(node => node.nodeValue || "").join("");
    const start = source.indexOf(value);
    if (start < 0) return false;
    root.focus?.();
    const point = (offset, end = false) => {
      let cursor = 0;
      for (const node of nodes) {
        const length = node.nodeValue?.length || 0;
        const next = cursor + length;
        if (offset < next || (end && offset === next)) return [node, offset - cursor];
        cursor = next;
      }
      const last = nodes[nodes.length - 1];
      return [last, last?.nodeValue?.length || 0];
    };
    const range = document.createRange();
    const [startNode, startOffset] = point(start);
    const [endNode, endOffset] = point(start + value.length, true);
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return true;
  }, text);
}

async function placeCaretInRoot(locator, text, offset) {
  return locator.evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const source = nodes.map(node => node.nodeValue || "").join("");
    const start = source.indexOf(value.text);
    if (start < 0 || value.offset < 0 || value.offset > value.text.length) return false;
    root.focus?.();
    let cursor = 0;
    for (const node of nodes) {
      const length = node.nodeValue?.length || 0;
      const target = start + value.offset;
      if (target < cursor + length || (target === cursor + length && node === nodes.at(-1))) {
        const range = document.createRange();
        range.setStart(node, target - cursor);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return true;
      }
      cursor += length;
    }
    return false;
  }, { text, offset });
}

async function placeCaretAtRootBoundary(locator, end = false) {
  return locator.evaluate((root, atEnd) => {
    root.focus?.();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(Boolean(atEnd));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return true;
  }, end);
}

function containerWithActiveSource(containerText, source) {
  const parsed = parseLyricContainer(containerText);
  const document = containerToReaderDocument(parsed);
  document.content.variants = document.content.variants.map(variant => variant.id === parsed.activeVariantId ? { ...variant, source: { text: source, url: "container:" } } : variant);
  return serializeLyricContainer(document, parsed.activeVariantId);
}

async function runWriterCoreGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const successfulResponses = new Set();
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  page.on("response", response => { if (response.ok()) successfulResponses.add(response.url()); else if (!expectedAssetFailure(response.url())) badResponses.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", request => {
    const failure = request.failure()?.errorText || "unknown";
    const harmlessCancellation = failure === "net::ERR_ABORTED" && successfulResponses.has(request.url());
    if (!expectedAssetFailure(request.url()) && !harmlessCancellation) failedRequests.push(`${request.method()} ${request.url()} [${failure}]`);
  });
  await mkdir(outputRoot, { recursive: true });
  const screenshot = path.join(outputRoot, "chromium-writer-core.png");
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => {
      const editor = document.querySelector("#source-editor");
      return Boolean(editor && /晴々撥条|如何《どう》/.test(editor.value) && editor.getAttribute("aria-invalid") !== "true");
    }, null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    stage = "valid Source to Viewer to Writer round trip";
    const validSource = `${originalSource}\n[Writer Core Gate:style=demo-chorus]`;
    await page.locator("#source-editor").fill(validSource);
    await page.waitForFunction(() => document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true" && /Writer Core Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => document.body.dataset.mode === "viewer" && /Writer Core Gate/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    assert.doesNotMatch(await page.locator("#lyrics").innerText(), /base-range=0-3/, "valid Writer Source must not expose parser markup in the Viewer");
    await clickHeaderButton(page, "#mode-switch");
    await page.waitForFunction(() => document.body.dataset.mode === "writer", null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, validSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), validSource, "valid Source round trip must preserve the entered Author Source");

    stage = "invalid Source keeps the current Document";
    const invalidSource = `${validSource}\n[x:base-range=0-3]`;
    await page.locator("#source-editor").fill(invalidSource);
    await page.waitForFunction(() => document.querySelector("#source-editor")?.getAttribute("aria-invalid") === "true", null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => document.body.dataset.mode === "viewer" && /Writer Core Gate/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    assert.doesNotMatch(await page.locator("#lyrics").innerText(), /base-range=0-3/, "invalid Source markup must not reach the Viewer");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") === null, validSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), validSource, "invalid Source must not replace the current Author Source");

    await page.screenshot({ path: screenshot, fullPage: false });
    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { status: "PASS", targetUrl, screenshot };
  } catch (error) {
    await page.screenshot({ path: path.join(outputRoot, "chromium-writer-core-failure.png"), fullPage: false }).catch(() => {});
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", source: document.querySelector("#source-editor")?.value || "", invalid: document.querySelector("#source-editor")?.getAttribute("aria-invalid") || null, viewer: document.querySelector("#lyrics")?.innerText || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify({ mode: state.mode, invalid: state.invalid, sourceTail: state.source.slice(-500), viewerTail: state.viewer.slice(-500) })} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)} failed=${JSON.stringify(failedRequests)} responses=${JSON.stringify(badResponses)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Core Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterViewStateGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();

    stage = "fresh Viewer has no dirty or Draft notice";
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => document.body.dataset.mode === "viewer", null, { timeout: 30_000 });
    const fresh = await page.evaluate(() => ({ dirty: document.body.dataset.dirty, draftHidden: document.querySelector("#draft-notice")?.hidden, draftKeys: Object.keys(localStorage).filter(key => key.startsWith("lyric-reader:draft:")) }));
    assert.equal(fresh.dirty, "false", "fresh Viewer must not be dirty");
    assert.equal(fresh.draftHidden, true, "fresh Viewer must not show a Draft recovery notice");
    assert.deepEqual(fresh.draftKeys, [], "fresh Viewer must not create a Draft");

    stage = "Viewer color override stays outside Document state";
    await page.locator("#settings-toggle").click({ force: true });
    await page.locator("#text-color").evaluate(element => { element.value = "#123456"; element.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() === "#123456", null, { timeout: 30_000 });
    const afterViewOverride = await page.evaluate(() => ({ dirty: document.body.dataset.dirty, draftHidden: document.querySelector("#draft-notice")?.hidden, draftKeys: Object.keys(localStorage).filter(key => key.startsWith("lyric-reader:draft:")) }));
    assert.equal(afterViewOverride.dirty, "false", "Viewer color override must not mark the Document dirty");
    assert.equal(afterViewOverride.draftHidden, true, "Viewer color override must not show a Draft notice");
    assert.deepEqual(afterViewOverride.draftKeys, [], "Viewer color override must not save a Draft");

    stage = "stale Draft is not a normal recovery candidate";
    await clickHeaderButton(page, "#settings-toggle");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#source-editor").fill(`${originalSource}\n[Ghost Draft Gate]`);
    await page.waitForFunction(() => document.body.dataset.dirty === "true", null, { timeout: 30_000 });
    const draftKey = await page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith("lyric-reader:draft:")) || "");
    assert.ok(draftKey, "Writer mutation must create a Draft candidate");
    await page.evaluate(key => { const draft = JSON.parse(localStorage.getItem(key) || "null"); draft.baseDocumentHash = "fnv1a:stale"; localStorage.setItem(key, JSON.stringify(draft)); }, draftKey);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    assert.equal(await page.locator("#draft-notice").isVisible(), false, "a stale Draft must not interrupt the normal Reader load");

    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", dirty: document.body.dataset.dirty || "", source: document.querySelector("#source-editor")?.value || "", draftHidden: document.querySelector("#draft-notice")?.hidden ?? null, status: document.querySelector("#source-status")?.textContent || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer View State Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterSourceGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const successfulResponses = new Set();
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  page.on("response", response => { if (response.ok()) successfulResponses.add(response.url()); else if (!expectedAssetFailure(response.url())) badResponses.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", request => {
    const failure = request.failure()?.errorText || "unknown";
    const harmlessCancellation = failure === "net::ERR_ABORTED" && successfulResponses.has(request.url());
    if (!expectedAssetFailure(request.url()) && !harmlessCancellation) failedRequests.push(`${request.method()} ${request.url()} [${failure}]`);
  });
  let stage = "initial";
  let originalSource = "";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    originalSource = await page.locator("#source-editor").inputValue();
    assert.match(originalSource, /晴々撥条|如何《どう》/);
    assert.match(originalSource, /^LYRIC-READER\/1\n/, "Source mode must expose the canonical full-document Container");

    stage = "variant source isolation";
    await clickHeaderButton(page, "#settings-toggle");
    assert.ok(await page.locator("#variant-mode option").count() >= 2, "Source Editor must expose the document Variant Set");
    stage = "Source Variant select modern";
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /こちらへ来たのだろう/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const modernSource = await page.locator("#source-editor").inputValue();
    await page.locator("#source-editor").fill(`${modernSource}\n[Source Variant Gate:style=demo-chorus]`);
    stage = "Source Variant first edit";
    await page.waitForFunction(() => /Source Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    stage = "Source Variant switch original after edit";
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(() => document.querySelector("#variant-mode")?.value === "original" && Boolean(document.querySelector("#source-editor")?.value), null, { timeout: 30_000 });
    const originalAfterVariantEdit = parseLyricContainer(await page.locator("#source-editor").inputValue());
    assert.equal(originalAfterVariantEdit.activeVariantId, "original");
    assert.equal(originalAfterVariantEdit.source, parseLyricContainer(originalSource).source, "editing another Variant must not change the active Original Source");
    stage = "Source Variant revisit modern";
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /Source Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    stage = "Source Variant switch original after revisit";
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(() => document.querySelector("#variant-mode")?.value === "original" && Boolean(document.querySelector("#source-editor")?.value), null, { timeout: 30_000 });
    const originalAfterSecondVariantSwitch = parseLyricContainer(await page.locator("#source-editor").inputValue());
    assert.equal(originalAfterSecondVariantSwitch.source, parseLyricContainer(originalSource).source, "switching back must preserve the Original Source after another Variant edit");
    await clickHeaderButton(page, "#settings-toggle");

    stage = "valid source to viewer round trip";
    const validSource = `${originalSource}\n[Source Gate:style=demo-chorus]`;
    await page.locator("#source-editor").fill(validSource);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#lyrics").innerText(), /Source Gate/);
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, validSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), validSource, "Source to Viewer round-trip must preserve the entered Author Source");

    stage = "invalid source protection";
    const invalidSource = `${validSource}\n[x:base-range=0-3]`;
    await page.locator("#source-editor").fill(invalidSource);
    await page.waitForFunction(() => document.querySelector("#source-editor")?.getAttribute("aria-invalid") === "true", null, { timeout: 30_000 });
    const invalidEditorState = await page.locator("#source-editor").evaluate(element => ({ value: element.value, selectionStart: element.selectionStart, selectionEnd: element.selectionEnd }));
    const invalidMarker = invalidSource.lastIndexOf("base-range");
    assert.equal(invalidEditorState.selectionStart, invalidMarker, "parse failure must move the caret to the reported source position");
    assert.equal(invalidEditorState.selectionEnd, invalidMarker + 1, "the failing token should be selected when possible");
    assert.match(await page.locator("#source-status").textContent() || "", /Sourceを反映できません/);
    assert.match(await page.locator("#source-status").textContent() || "", /付近.*base-range/);
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#lyrics").innerText(), /Source Gate/);
    assert.doesNotMatch(await page.locator("#lyrics").innerText(), /base-range=0-3/);
    await clickHeaderButton(page, "#source-mode-switch");
    assert.equal(await page.locator("#source-editor").getAttribute("aria-invalid"), null, "Viewer fallback must clear the transient Source Editor error");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, validSource, { timeout: 30_000 });

    stage = "native source undo";
    await page.locator("#source-editor").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n[Source Native Undo Gate]");
    await page.waitForFunction(() => /Source Native Undo Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, validSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), validSource, "Source Editor must retain the textarea native Undo path");

    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", invalid: document.querySelector("#source-editor")?.getAttribute("aria-invalid"), status: document.querySelector("#source-status")?.textContent || "", dirty: document.body.dataset.dirty || "" })).catch(() => ({}));
    const sourceTail = await page.locator("#source-editor").inputValue().catch(() => "");
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} sourceTail=${JSON.stringify(sourceTail.slice(-500))} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Source Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterDocumentGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const successfulResponses = new Set();
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  page.on("response", response => { if (response.ok()) successfulResponses.add(response.url()); else if (!expectedAssetFailure(response.url())) badResponses.push(`${response.status()} ${response.url()}`); });
  page.on("requestfailed", request => {
    const failure = request.failure()?.errorText || "unknown";
    const harmlessCancellation = failure === "net::ERR_ABORTED" && successfulResponses.has(request.url());
    if (!expectedAssetFailure(request.url()) && !harmlessCancellation) failedRequests.push(`${request.method()} ${request.url()} [${failure}]`);
  });
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    const originalSourceUrl = await page.evaluate(() => document.querySelector("#source-url")?.value || "");
    assert.match(originalSource, /晴々撥条|如何《どう》/);

    stage = "initial load settles before invalid document";
    await page.locator("#source-editor").fill(`${originalSource}\n[Writer Document Gate]`);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    await page.locator("#source-file").setInputFiles({ name: "broken.reader.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ version: 3, content: { variants: [] } })) });
    await page.locator("#reader-error").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#reader-error").textContent() || "", /本文がありません/);
    assert.equal(await page.locator("#source-editor").inputValue(), originalSource, "invalid document must not replace the current source after initial load");
    await page.locator("#draft-notice").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#draft-restore").click({ force: true });
    await page.waitForFunction(() => /Writer Document Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });

    stage = "failed URL rollback";
    const sourceBeforeRemoteFailure = await page.locator("#source-editor").inputValue();
    const invalidRemoteUrl = `${new URL(targetUrl).origin}/tests/fixtures/missing-reader.txt`;
    await clickHeaderButton(page, "#settings-toggle");
    await page.locator("#source-url").fill(invalidRemoteUrl);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#url-open-button").click({ force: true });
    await page.locator("#reader-error").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#reader-error").textContent() || "", /本文を取得できませんでした/);
    assert.equal(await page.locator("#source-editor").inputValue(), sourceBeforeRemoteFailure, "invalid URL document must not replace the current source");
    await clickHeaderButton(page, "#settings-toggle");

    stage = "document-open undo snapshot";
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    const documentABeforeOpen = await page.evaluate(() => ({
      source: document.querySelector("#source-editor")?.value || "",
      activeVariant: document.querySelector("#variant-mode")?.value || "",
      sourceUrl: document.querySelector("#source-url")?.value || "",
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
      ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()
    }));
    assert.equal(documentABeforeOpen.activeVariant, "original");
    assert.equal(documentABeforeOpen.sourceUrl, originalSourceUrl, "failed URL attempts must not replace Document A routing");

    await clickHeaderButton(page, "#mode-switch");
    await clickHeaderButton(page, "#settings-toggle");
    const remoteSourceUrl = `${new URL(targetUrl).origin}/data/demo/lyrics-historical.txt`;
    await page.locator("#source-url").fill(remoteSourceUrl);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#url-open-button").click({ force: true });
    await page.waitForFunction(() => /曲前フリ/.test(document.querySelector("#song-title")?.textContent || ""), null, { timeout: 30_000 });
    await page.waitForFunction(() => /URL本文を読み込みました/.test(document.querySelector("#source-status")?.textContent || ""), null, { timeout: 30_000 });
    assert.equal(await page.locator("#reader-error").isHidden(), true, "successful document load must clear an earlier load error");
    const documentBState = await page.evaluate(() => ({
      activeVariant: document.querySelector("#variant-mode")?.value || "",
      sourceUrl: document.querySelector("#source-url")?.value || ""
    }));
    assert.equal(documentBState.sourceUrl, remoteSourceUrl, "Document B must expose its URL routing");
    await page.locator("#undo-button").click({ force: true });
    const restoredDocumentA = await page.evaluate(() => ({
      source: document.querySelector("#source-editor")?.value || "",
      activeVariant: document.querySelector("#variant-mode")?.value || "",
      sourceUrl: document.querySelector("#source-url")?.value || "",
      paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
      ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()
    }));
    assert.deepEqual(restoredDocumentA, documentABeforeOpen, "Document-open Undo must restore the complete Document A state");

    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", source: document.querySelector("#source-editor")?.value || "", status: document.querySelector("#source-status")?.textContent || "", error: document.querySelector("#reader-error")?.textContent || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Document Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterWysiwygGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    const wysiwygSeedSource = `${originalSource}\n[Writer Gate:style=demo-chorus]`;
    await page.locator("#source-editor").fill(wysiwygSeedSource);
    await page.waitForFunction(() => /Writer Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });

    const resetWriterSource = async source => {
      if (await page.evaluate(() => document.body.dataset.mode) !== "source") await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator("#source-editor").fill(source);
      await page.waitForFunction(expected => document.querySelector("#source-editor")?.value === expected && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", source, { timeout: 30_000 });
      await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
      await clickHeaderButton(page, "#mode-switch");
      await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    };

    stage = "contenteditable undo redo";
    assert.equal(await selectTextInRoot(page.locator("#lyrics"), "Writer Gate"), true, "WYSIWYG gate must find its editable presentation text");
    await page.keyboard.insertText("Writer Undo");
    await page.waitForFunction(() => /Writer Undo/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await page.waitForTimeout(750);
    await page.waitForFunction(() => document.querySelector("#undo-button")?.disabled === false, null, { timeout: 30_000 });
    await page.locator("#lyrics").focus();
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => /Writer Gate/.test(document.querySelector("#lyrics")?.innerText || "") && !/Writer Undo/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("#redo-button")?.disabled === false, null, { timeout: 30_000 });
    await clickHeaderButton(page, "#redo-button");
    await page.waitForFunction(() => /Writer Undo/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });

    stage = "contenteditable source projection";
    await clickHeaderButton(page, "#source-mode-switch");
    const redoSource = await page.locator("#source-editor").inputValue();
    assert.match(redoSource, /\[Writer Undo:style=demo-chorus\]/, `WYSIWYG redo must restore the presentation-aware Author Source: ${redoSource.slice(-500)}`);
    assert.doesNotMatch(redoSource, /Writer Gate:style=demo-chorus/, "WYSIWYG redo must keep the replaced text");

    stage = "contenteditable collapsed caret input";
    await resetWriterSource(wysiwygSeedSource);
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "Writer Gate", 7), true, "WYSIWYG gate must place a collapsed caret inside its editable presentation text");
    await page.keyboard.insertText("X");
    await page.waitForFunction(() => /Writer XGate/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    const caretSource = await page.locator("#source-editor").inputValue();
    assert.match(caretSource, /\[Writer XGate:style=demo-chorus\]/, `collapsed caret input must retain the existing Presentation: ${caretSource.slice(-500)}`);

    stage = "contenteditable newline";
    await resetWriterSource(wysiwygSeedSource);
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "Writer Gate", 7), true, "WYSIWYG gate must place a caret before the newline operation");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Writer[\s\S]*Gate/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    const newlineSource = await page.locator("#source-editor").inputValue();
    const newlinePortable = toPortableText(parseSource(newlineSource, canonicalAdapter), canonicalAdapter);
    assert.match(newlinePortable, /Writer \r?\nGate/, `WYSIWYG newline must become Portable Source text: ${newlineSource.slice(-500)}`);
    assert.match(newlineSource, /\[Writer .*style=demo-chorus\]\r?\n\[Gate:style=demo-chorus\]/, `WYSIWYG newline must retain the existing Presentation: ${newlineSource.slice(-500)}`);

    stage = "contenteditable plain text paste";
    await resetWriterSource(wysiwygSeedSource);
    assert.equal(await selectTextInRoot(page.locator("#lyrics"), "Writer Gate"), true, "WYSIWYG gate must select the presentation text before paste");
    await page.locator("#lyrics").evaluate(element => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? "Writer Paste" : "<strong>unsafe html</strong>" } });
      element.dispatchEvent(event);
    });
    await page.waitForFunction(() => /Writer Paste/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    const pasteSource = await page.locator("#source-editor").inputValue();
    assert.match(pasteSource, /\[Writer Paste:style=demo-chorus\]/, `Plain-text paste must retain the existing Presentation: ${pasteSource.slice(-500)}`);
    assert.doesNotMatch(pasteSource, /unsafe html|<strong>/, "WYSIWYG paste must not import HTML into Author Source");

    stage = "contenteditable deletion";
    await resetWriterSource(wysiwygSeedSource);
    assert.equal(await selectTextInRoot(page.locator("#lyrics"), "Writer Gate"), true, "WYSIWYG gate must select the presentation text before deletion");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => !/Writer Gate/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    const deleteSource = await page.locator("#source-editor").inputValue();
    assert.doesNotMatch(deleteSource, /Writer Gate/, `WYSIWYG deletion must remove the selected Author Source text: ${deleteSource.slice(-500)}`);
    assert.equal(await page.locator("#source-editor").getAttribute("aria-invalid"), null, "WYSIWYG deletion must keep the resulting Source parseable");

    stage = "contenteditable title editing";
    await resetWriterSource(wysiwygSeedSource);
    const originalTitle = (await page.locator("#song-title").innerText()).trim();
    assert.equal(await selectTextInRoot(page.locator("#song-title"), originalTitle), true, "WYSIWYG gate must select the first-line title");
    await page.keyboard.insertText("Writer Title");
    await page.waitForFunction(() => /Writer Title/.test(document.querySelector("#song-title")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    const titleSource = await page.locator("#source-editor").inputValue();
    const titleContainer = parseLyricContainer(titleSource);
    assert.equal(titleContainer.source.split(/\r?\n/, 1)[0], "Writer Title", `Title editing must update only the first Author Source line: ${titleContainer.source.slice(0, 200)}`);
    assert.match(titleContainer.source, /Writer Gate/, "Title editing must preserve the body Source");

    await resetWriterSource(originalSource);
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), originalSource, "WYSIWYG detail operations must finish with the original Author Source");
    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", source: document.querySelector("#source-editor")?.value || "", viewer: document.querySelector("#lyrics")?.innerText || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer WYSIWYG Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterRubyGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  let stage = "initial";
    const fixture = "Ruby Gate\n前｜読確認《よみかくにん》後\n前｜ペウコ《ピョコ》後\n如何《どう》";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();

    const resetWriterSource = async source => {
      if (await page.evaluate(() => document.body.dataset.mode) !== "source") await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator("#source-editor").fill(source);
      await page.waitForFunction(expected => document.querySelector("#source-editor")?.value === expected && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", source, { timeout: 30_000 });
      await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
      await clickHeaderButton(page, "#mode-switch");
      await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    };
    const readSource = async () => {
      if (await page.evaluate(() => document.body.dataset.mode) !== "source") await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      return page.locator("#source-editor").inputValue();
    };
    const placeCaretBeforeRuby = async index => page.locator("#lyrics .source-ruby").nth(index).evaluate(node => {
      const range = document.createRange(); range.setStartBefore(node); range.collapse(true);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); node.parentElement?.focus();
      document.dispatchEvent(new Event("selectionchange")); return true;
    });
    const flattenRuby = async index => page.locator("#lyrics .source-ruby").nth(index).evaluate(node => {
      const ruby = node.querySelector("ruby"); if (!ruby) return false; ruby.replaceWith(document.createTextNode(node.textContent || "")); return true;
    });

    const fixtureContainer = containerWithActiveSource(originalSource, fixture);

    stage = "Ruby before-neighbor input";
    await resetWriterSource(fixtureContainer);
    assert.equal(await flattenRuby(0), true, "Ruby gate must be able to simulate a flattened Ruby DOM");
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "後", 0), true, "Ruby gate must place a caret after the first Ruby");
    const caretBeforeRubyInput = await page.evaluate(() => { const selection = window.getSelection(); return { active: document.activeElement?.id || document.activeElement?.className || "", anchor: selection?.anchorNode?.parentElement?.outerHTML?.slice(0, 240) || "", text: selection?.toString() || "" }; });
    assert.match(caretBeforeRubyInput.anchor, /source-text/, `Ruby gate caret must be outside Ruby before input: ${JSON.stringify(caretBeforeRubyInput)}`);
    await page.keyboard.insertText("A");
    await page.waitForFunction(() => /A後/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    let source = await readSource();
    assert.match(source, /前｜読確認《よみかくにん》A後/, `editing after a flattened Ruby must preserve Ruby Source: ${source}`);

    stage = "Ruby after-neighbor input";
    await resetWriterSource(fixtureContainer);
    assert.equal(await flattenRuby(1), true, "Ruby gate must flatten the second Ruby");
    await placeCaretBeforeRuby(1);
    await page.keyboard.insertText("B");
    await page.waitForFunction(() => /前B/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    source = await readSource();
    assert.match(source, /前B｜ペウコ《ピョコ》後/, `editing before a flattened Ruby must preserve Ruby Source: ${source}`);

    stage = "Ruby neighbor deletion";
    await resetWriterSource(fixtureContainer);
    assert.equal(await flattenRuby(0), true, "Ruby deletion gate must be able to simulate a flattened Ruby DOM");
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "後", 0), true, "Ruby deletion gate must place a caret after the first Ruby");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => !/読確認/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    source = await readSource();
    assert.match(source, /前後\r?\n/, `deleting across a flattened Ruby must remove the Ruby as one semantic unit: ${source}`);

    stage = "Ruby previous-neighbor deletion";
    await resetWriterSource(fixtureContainer);
    assert.equal(await flattenRuby(0), true, "Ruby previous-neighbor gate must be able to simulate a flattened Ruby DOM");
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "読確認よみかくにん", 0), true, "Ruby previous-neighbor gate must place a caret before the flattened Ruby");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => /読確認よみかくにん/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    source = await readSource();
    assert.match(source, /\r?\n｜読確認《よみかくにん》後/, `deleting before a flattened Ruby must preserve Ruby Source: ${source}`);

    stage = "Ruby-adjacent line break";
    await resetWriterSource(fixtureContainer);
    assert.equal(await flattenRuby(0), true, "Ruby line-break gate must be able to simulate a flattened Ruby DOM");
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "後", 0), true, "Ruby line-break gate must place a caret after the first Ruby");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /読確認よみかくにん[\r\n]+後/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    source = await readSource();
    assert.match(source, /前｜読確認《よみかくにん》\r?\n後/, `line break next to a flattened Ruby must preserve Ruby Source: ${source}`);

    stage = "Ruby-crossing selection deletion";
    await resetWriterSource(fixtureContainer);
    assert.equal(await selectTextInRoot(page.locator("#lyrics"), "前読確認よみかくにん後"), true, "Ruby crossing selection must include the complete Ruby and neighboring text");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => !/読確認/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    source = await readSource();
    assert.doesNotMatch(source, /読確認|よみかくにん/, `Ruby-crossing deletion must remove the selected Ruby as one semantic range: ${source}`);
    assert.match(source, /前｜ペウコ《ピョコ》後/, `Ruby-crossing deletion must preserve the untouched Ruby: ${source}`);

    stage = "Ruby reading edit";
    await resetWriterSource(fixtureContainer);
    assert.equal(await selectTextInRoot(page.locator("#lyrics .source-ruby").first(), "よみかくにん"), true, "Ruby gate must select the reading portion");
    await page.keyboard.insertText("読み");
    await page.waitForFunction(() => /読み/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    source = await readSource();
    assert.match(source, /前｜読確認《読み》後/, `editing Ruby reading must keep Ruby syntax: ${source}`);

    stage = "Portable Ruby copy and paste";
    await resetWriterSource(fixtureContainer);
    assert.equal(await selectTextInRoot(page.locator("#lyrics .source-ruby").first(), "読確認よみかくにん"), true, "Ruby gate must select the complete Ruby for copy");
    const copied = await page.locator("#lyrics").evaluate(element => {
      let value = "";
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { setData: (type, next) => { if (type === "text/plain") value = next; } } });
      element.dispatchEvent(event); return value;
    });
    assert.equal(copied, "｜読確認《よみかくにん》", `Ruby copy must use Portable Ruby text: ${copied}`);
    await placeCaretBeforeRuby(1);
    await page.locator("#lyrics").evaluate((element, text) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? text : "" } });
      element.dispatchEvent(event);
    }, copied);
    await page.waitForFunction(() => (document.querySelectorAll("#lyrics .source-ruby").length || 0) >= 3, null, { timeout: 30_000 });
    source = await readSource();
    assert.match(source, /前｜読確認《よみかくにん》｜ペウコ《ピョコ》後/, `Portable Ruby paste must restore Ruby syntax: ${source}`);
    assert.doesNotMatch(source, /\\｜読確認|\\《よみかくにん/, "Portable Ruby paste must not become escaped literal text");

    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", source: document.querySelector("#source-editor")?.value || "", viewer: document.querySelector("#lyrics")?.innerText || "", active: document.activeElement?.id || document.activeElement?.className || "", selection: (() => { const value = window.getSelection(); return value?.rangeCount ? { text: value.toString(), collapsed: value.isCollapsed, anchor: value.anchorNode?.parentElement?.outerHTML?.slice(0, 240) || "" } : null; })(), rubyHtml: document.querySelector("#lyrics .source-ruby")?.outerHTML?.slice(0, 500) || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Ruby Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterBoundaryGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  const fixture = "Boundary Title\n本文一行目\n本文二行目";
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /^LYRIC-READER\/1\n/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    const fixtureSource = containerWithActiveSource(originalSource, fixture);
    const resetWriterSource = async () => {
      if (await page.evaluate(() => document.body.dataset.mode) !== "source") await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").fill(fixtureSource);
      await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", fixtureSource, { timeout: 30_000 });
      await clickHeaderButton(page, "#source-mode-switch");
      await clickHeaderButton(page, "#mode-switch");
      await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    };
    const readSource = async () => {
      await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      return parseLyricContainer(await page.locator("#source-editor").inputValue()).source;
    };

    stage = "title end Enter moves to body";
    await resetWriterSource();
    await placeCaretAtRootBoundary(page.locator("#song-title"), true);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "lyrics", null, { timeout: 30_000 });
    assert.equal(await readSource(), fixture, "Title-boundary Enter must preserve the canonical Source while moving focus to Body");

    stage = "body start Backspace moves to title";
    await resetWriterSource();
    await placeCaretAtRootBoundary(page.locator("#lyrics"), false);
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.activeElement?.id === "song-title", null, { timeout: 30_000 });
    assert.equal(await readSource(), fixture, "Body-boundary Backspace must preserve the canonical Source while moving focus to Title");

    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", active: document.activeElement?.id || document.activeElement?.className || "", source: document.querySelector("#source-editor")?.value || "", title: document.querySelector("#song-title")?.innerText || "", lyrics: document.querySelector("#lyrics")?.innerText || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Boundary Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterCompositionGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(`${message.text()} (${message.location().url})`); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  const fixture = "IME Title\n本文";
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /^LYRIC-READER\/1\n/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    const fixtureSource = containerWithActiveSource(originalSource, fixture);
    const resetWriterSource = async () => {
      if (await page.evaluate(() => document.body.dataset.mode) !== "source") await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").fill(fixtureSource);
      await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", fixtureSource, { timeout: 30_000 });
      await clickHeaderButton(page, "#source-mode-switch");
      await clickHeaderButton(page, "#mode-switch");
      await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    };
    const readSource = async () => {
      await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      return parseLyricContainer(await page.locator("#source-editor").inputValue()).source;
    };
    const dispatchCompositionWithoutFinalInput = async (locator, data) => locator.evaluate((root, value) => {
      root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode) throw new Error("composition fixture has no text node");
      textNode.nodeValue += value;
      root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: value }));
      root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: value }));
    }, data);

    stage = "title composition commits without trailing input";
    await resetWriterSource();
    await placeCaretAtRootBoundary(page.locator("#song-title"), true);
    await dispatchCompositionWithoutFinalInput(page.locator("#song-title"), "かな");
    await page.waitForFunction(() => /IME Titleかな/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    assert.equal((await readSource()).split(/\r?\n/, 1)[0], "IME Titleかな", "Title compositionend must commit the final text even without a trailing input event");

    stage = "body composition commits without trailing input";
    await resetWriterSource();
    await dispatchCompositionWithoutFinalInput(page.locator("#lyrics"), "かな");
    await page.waitForFunction(() => /本文かな/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    assert.equal(await readSource(), fixture.replace("本文", "本文かな"), "Body compositionend must commit the final text even without a trailing input event");

    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } catch (error) {
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", active: document.activeElement?.id || document.activeElement?.className || "", source: document.querySelector("#source-editor")?.value || "", title: document.querySelector("#song-title")?.innerText || "", lyrics: document.querySelector("#lyrics")?.innerText || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Composition Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runWriterTabGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const observe = tab => {
    tab.on("console", message => { if (message.type() === "error" && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(message.text()); });
    tab.on("pageerror", error => pageErrors.push(String(error)));
  };
  observe(page);
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const firstSource = await page.locator("#source-editor").inputValue();
    await page.locator("#source-editor").fill(`${firstSource}\n[Writer Tab:first]`);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, firstSource, { timeout: 30_000 });
    await page.locator("#draft-notice").waitFor({ state: "visible", timeout: 30_000 });

    const secondTab = await context.newPage();
    observe(secondTab);
    try {
      await secondTab.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await secondTab.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      await secondTab.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
      const secondSource = await secondTab.locator("#source-editor").inputValue();
      await secondTab.locator("#source-editor").fill(`${secondSource}\n[Writer Tab:second]`);
      await secondTab.waitForFunction(() => document.body.dataset.dirty === "true");
      const draftEntries = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("lyric-reader:draft:")).map(key => [key, localStorage.getItem(key) || ""]));
      const tabKeys = draftEntries.map(([key]) => key.split(":tab:")[1]).filter(Boolean);
      assert.ok(tabKeys.length >= 2, "each Tab must create an independent Draft key");
      assert.equal(new Set(tabKeys).size, tabKeys.length, "Draft keys must not share a Tab identity");
      const firstTabDraftKey = draftEntries.find(([, value]) => value.includes("[Writer Tab:first]"))?.[0];
      const secondTabDraftKey = draftEntries.find(([, value]) => value.includes("[Writer Tab:second]"))?.[0];
      assert.ok(firstTabDraftKey, "the first Tab must have its own recoverable Draft");
      assert.ok(secondTabDraftKey, "the second Tab must have its own recoverable Draft");
      const secondTabDraftBeforeCleanup = await page.evaluate(key => localStorage.getItem(key), secondTabDraftKey);
      await page.locator("#draft-discard").click({ force: true });
      await page.waitForFunction(key => localStorage.getItem(key) === null, firstTabDraftKey, { timeout: 30_000 });
      assert.equal(await page.evaluate(key => localStorage.getItem(key), secondTabDraftKey), secondTabDraftBeforeCleanup, "discarding one Tab's Draft must not remove another Tab's Draft");
      assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
      return { status: "PASS", targetUrl };
    } finally {
      await secondTab.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runStorageFailureGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  await context.addInitScript(() => {
    const local = window.localStorage;
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        if (this === local) throw new Error("Storage blocked by Writer Beta failure injection");
        return original.apply(this, args);
      };
    }
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !expectedAssetFailure(message.location().url) && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const original = await page.locator("#source-editor").inputValue();
    await page.locator("#source-editor").fill(`${original}\n[Storage Failure Gate]`);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    assert.match(await page.locator("#source-status").textContent() || "", /自動復元用Storage/);
    assert.match(await page.locator("#source-editor").inputValue(), /Storage Failure Gate/);
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    assert.match(await page.locator("#lyrics").innerText(), /Storage Failure Gate/);
    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runMalformedDraftGate(targetUrl) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ja-JP", colorScheme: "light" });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => { if (message.type() === "error" && !/Failed to load resource:/i.test(message.text())) consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(String(error)));
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const original = await page.locator("#source-editor").inputValue();
    await page.locator("#source-editor").fill(`${original}\n[Malformed Draft Seed]`);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    const draftKey = await page.evaluate(() => Object.entries(localStorage).find(([key, value]) => key.startsWith("lyric-reader:draft:") && value.includes("Malformed Draft Seed"))?.[0] || "");
    assert.ok(draftKey, "malformed Draft gate must find the current Tab's Draft key");
    await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 3, document: { variants: [{ id: "broken", label: "Broken", source: { text: "" } }], manifest: {} } })), draftKey);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, original, { timeout: 30_000 });
    await page.locator("#draft-notice").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#draft-restore").click({ force: true });
    await page.waitForFunction(() => /Draft|本文/.test(document.querySelector("#source-status")?.textContent || ""), null, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), original, "an empty malformed Draft must not replace the current Author Source");
    assert.deepEqual({ consoleErrors, pageErrors }, { consoleErrors: [], pageErrors: [] });
    return { status: "PASS", targetUrl };
  } finally {
    await context.close();
    await browser.close();
  }
}

const local = requestedUrl ? null : await startLocalServer();
const targetUrl = requestedUrl || local.url;
try {
  const gates = [
    ["writer", runWriterCoreGate],
    ["writerViewState", runWriterViewStateGate],
    ["writerSource", runWriterSourceGate],
    ["writerDocument", runWriterDocumentGate],
    ["writerWysiwyg", runWriterWysiwygGate],
    ["writerRuby", runWriterRubyGate],
    ["writerBoundary", runWriterBoundaryGate],
    ["writerComposition", runWriterCompositionGate],
    ["writerTab", runWriterTabGate],
    ["storageFailure", runStorageFailureGate],
    ["malformedDraft", runMalformedDraftGate]
  ];
  const selectedGate = process.env.WRITER_GATE_ONLY?.trim();
  const runnableGates = selectedGate ? gates.filter(([name]) => name === selectedGate) : gates;
  if (selectedGate && runnableGates.length === 0) throw new Error(`Unknown Writer gate: ${selectedGate}`);
  const { results, failed } = await runWriterGateSuite(runnableGates, targetUrl);
  console.log(JSON.stringify(results, null, 2));
  if (failed) process.exitCode = 1;
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
