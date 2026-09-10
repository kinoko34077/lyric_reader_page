import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { getSyntaxAdapter, parseSource, serializeSource, toPortableText } from "../assets/js/syntax-adapter.js";
import { runWriterGateSuite } from "./writer-gate-runner.mjs";

const root = path.resolve(process.cwd());
const outputRoot = process.env.WRITER_GATE_OUTPUT || path.join(os.tmpdir(), "lyric-reader-writer-gate");
const requestedUrl = process.env.WRITER_GATE_URL?.trim();
const canonicalAdapter = getSyntaxAdapter("narou-text");
const canonicalAuthorSource = source => serializeSource(parseSource(source, canonicalAdapter), canonicalAdapter);

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
    return true;
  }, text);
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

async function runGate(targetUrl) {
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
  const screenshot = path.join(outputRoot, "chromium-source-editor.png");
  let stage = "initial";
  let diagnosticExpected = "";

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    const documentAInitialSourceUrl = await page.evaluate(() => document.querySelector("#source-url")?.value || "");
    assert.match(originalSource, /晴々撥条|如何《どう》/);

    await clickHeaderButton(page, "#settings-toggle");
    assert.ok(await page.locator("#variant-mode option").count() >= 2, "Source Editor must expose the document Variant Set");
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /こちらへ来たのだろう/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const modernSource = await page.locator("#source-editor").inputValue();
    assert.notEqual(modernSource, originalSource);
    await page.locator("#source-editor").fill(`${modernSource}\n[Variant Gate:style=demo-chorus]`);
    await page.waitForFunction(() => /Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    assert.doesNotMatch(await page.locator("#source-editor").inputValue(), /Variant Gate/);
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    await clickHeaderButton(page, "#settings-toggle");

    const editedSource = `${originalSource}\n[Writer Gate:style=demo-chorus]`;
    await page.locator("#source-editor").fill(editedSource);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    assert.match(await page.locator("#source-status").textContent() || "", /未保存/);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    await page.locator("#source-file").setInputFiles({ name: "broken.reader.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ version: 3, content: { variants: [] } })) });
    await page.locator("#reader-error").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#reader-error").textContent() || "", /本文がありません/);
    assert.equal(await page.locator("#source-editor").inputValue(), originalSource, "invalid document must not replace the current source");
    await page.locator("#draft-notice").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#draft-restore").click();
    await page.waitForFunction(() => /Writer Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#settings-toggle");
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(() => /Writer Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#settings-toggle");

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

    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    assert.match(await page.locator("#lyrics").innerText(), /Writer Gate/);

    const documentABeforeOpen = await page.evaluate(() => {
      const styled = document.querySelector('#lyrics .source-presentation[data-style="demo-title"]');
      return {
        activeVariant: document.querySelector("#variant-mode")?.value || "",
        sourceUrl: document.querySelector("#source-url")?.value || "",
        paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
        ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
        styleBackground: styled?.style.backgroundImage || "",
        styleColor: styled?.style.color || "",
        styleHasWarning: Boolean(styled?.querySelector(".view-warning"))
      };
    });
    assert.equal(documentABeforeOpen.activeVariant, "original");
    assert.equal(documentABeforeOpen.sourceUrl, documentAInitialSourceUrl, "failed URL attempts must not replace Document A routing");
    assert.ok(documentABeforeOpen.styleBackground || documentABeforeOpen.styleColor, "Document A Registry style must resolve before opening Document B");
    assert.equal(documentABeforeOpen.styleHasWarning, false, "Document A known Style must not warn before opening Document B");

    await clickHeaderButton(page, "#mode-switch");
    await clickHeaderButton(page, "#settings-toggle");
    const remoteSourceUrl = `${new URL(targetUrl).origin}/data/demo/lyrics-historical.txt`;
    await page.locator("#source-url").fill(remoteSourceUrl);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#url-open-button").click({ force: true });
    await page.waitForFunction(() => /曲前フリ/.test(document.querySelector("#song-title")?.textContent || ""), null, { timeout: 30_000 });
    await page.waitForFunction(() => /URL本文を読み込みました/.test(document.querySelector("#source-status")?.textContent || ""), null, { timeout: 30_000 });
    assert.match(await page.locator("#source-status").textContent() || "", /URL本文を読み込みました/);
    assert.equal(await page.locator("#reader-error").isHidden(), true, "successful document load must clear an earlier load error");
    const documentBState = await page.evaluate(() => ({
      activeVariant: document.querySelector("#variant-mode")?.value || "",
      sourceUrl: document.querySelector("#source-url")?.value || "",
      styleHasWarning: Boolean(document.querySelector('#lyrics .source-presentation[data-style="demo-title"] .view-warning'))
    }));
    assert.equal(documentBState.sourceUrl, remoteSourceUrl, "Document B must expose its URL routing");
    assert.equal(documentBState.styleHasWarning, true, "Document B without the original Registry must expose a Style warning");
    await page.locator("#undo-button").click({ force: true });
    const restoredDocumentA = await page.evaluate(() => {
      const styled = document.querySelector('#lyrics .source-presentation[data-style="demo-title"]');
      return {
        activeVariant: document.querySelector("#variant-mode")?.value || "",
        sourceUrl: document.querySelector("#source-url")?.value || "",
        paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
        ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
        styleBackground: styled?.style.backgroundImage || "",
        styleColor: styled?.style.color || "",
        styleHasWarning: Boolean(styled?.querySelector(".view-warning"))
      };
    });
    assert.deepEqual(restoredDocumentA, documentABeforeOpen, "Document-open Undo must restore the complete Document A state");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /Writer Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    assert.match(await page.locator("#source-editor").inputValue(), /Writer Gate/);

    const invalidSource = `${editedSource}\n[x:base-range=0-3]`;
    await page.locator("#source-editor").fill(invalidSource);
    await page.waitForFunction(() => document.querySelector("#source-editor")?.getAttribute("aria-invalid") === "true");
    assert.match(await page.locator("#source-status").textContent() || "", /Sourceを反映できません/);
    assert.match(await page.locator("#source-status").textContent() || "", /行\d+・列\d+/);
    const invalidEditorState = await page.locator("#source-editor").evaluate(element => ({
      value: element.value,
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd
    }));
    const invalidMarker = invalidSource.lastIndexOf("base-range");
    assert.equal(invalidEditorState.selectionStart, invalidMarker, "parse failure must move the caret to the reported source position");
    assert.equal(invalidEditorState.selectionEnd, invalidMarker + 1, "the failing token should be selected when possible");
    assert.match(await page.locator("#source-status").textContent() || "", /付近.*base-range/);

    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    const viewerText = await page.locator("#lyrics").innerText();
    assert.match(viewerText, /Writer Gate/);
    assert.doesNotMatch(viewerText, /base-range=0-3/);
    assert.equal(await page.locator("#source-editor").getAttribute("aria-invalid"), null);

    const selectTextIn = async (locator, text) => {
      const selected = await locator.evaluate((root, value) => {
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
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return true;
      }, text);
      assert.equal(selected, true, `Writer must be able to select ${text}`);
    };
    const selectLyricsText = text => selectTextIn(page.locator("#lyrics"), text);
    const setSettingsOpen = async open => {
      const panel = page.locator("#settings-panel");
      const hidden = await panel.evaluate(element => element.hidden);
      if (hidden === open) await clickHeaderButton(page, "#settings-toggle");
      await page.waitForFunction(expected => document.querySelector("#settings-panel")?.hidden === !expected, open, { timeout: 30_000 });
    };
    const placeCaretIn = async (locator, text, offset) => {
      const placed = await locator.evaluate((root, value) => {
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
          if (start + value.offset <= cursor + length) {
            const range = document.createRange();
            range.setStart(node, start + value.offset - cursor);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
            return true;
          }
          cursor += length;
        }
        return false;
      }, { text, offset });
      assert.equal(placed, true, `Writer must be able to place a caret in ${text}`);
    };

    await clickHeaderButton(page, "#mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    await selectLyricsText("Reader Smoke");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /\[Reader Smoke:style=demo-chorus\]/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#palette-slot").selectOption("2");
    assert.equal(await page.locator("#palette-slot").inputValue(), "2", "Palette Slot selection must survive control synchronization");
    await page.locator("#apply-palette-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /\[Reader Smoke:(?:c=2(?:,bank=default)?,style=demo-chorus|style=demo-chorus,c=2(?:,bank=default)?)\]/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const clearedAuthorSource = await page.locator("#source-editor").inputValue();
    assert.match(clearedAuthorSource, /Reader Smoke/);
    assert.doesNotMatch(clearedAuthorSource, /\[Reader Smoke:/);

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#style-name").fill("demo-title");
    await page.locator("#style-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const multipleStyleSource = await page.locator("#source-editor").inputValue();
    assert.match(multipleStyleSource, /\[Reader Smoke:style=demo-chorus,style=demo-title\]|\[Reader Smoke:style=demo-title,style=demo-chorus\]/, `Multiple Styles were not retained in Author Source: ${multipleStyleSource.slice(-500)}`);
    await clickHeaderButton(page, "#source-mode-switch");
    const conflict = page.locator('#lyrics .source-presentation.presentation-conflict').filter({ hasText: "Reader Smoke" });
    await conflict.waitFor({ state: "visible", timeout: 30_000 });
    await conflict.locator(".view-warning").waitFor({ state: "visible", timeout: 30_000 });
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#palette-bank").selectOption("night");
    await page.locator("#palette-slot").selectOption("2");
    await page.locator("#apply-palette-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const bankSource = await page.locator("#source-editor").inputValue();
    assert.match(bankSource, /\[Reader Smoke:c=2,bank=night\]/, `Palette Bank authoring was not serialized: ${bankSource.slice(-500)}`);
    await clickHeaderButton(page, "#source-mode-switch");
    const bankPresentation = page.locator('#lyrics .source-presentation[data-bank="night"][data-palette="2"]').filter({ hasText: "Reader Smoke" });
    await bankPresentation.waitFor({ state: "visible", timeout: 30_000 });
    assert.ok(await bankPresentation.evaluate(element => element.style.color), "Palette Bank authoring must reach the resolved viewer color");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });
    await page.locator("#palette-bank").selectOption("default");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#presentation-font-name").fill("missing-font");
    await page.locator("#presentation-font-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const presentationFontSource = await page.locator("#source-editor").inputValue();
    assert.match(presentationFontSource, /\[Reader Smoke:font=missing-font\]/, `Font authoring was not serialized: ${presentationFontSource.slice(-500)}`);
    await clickHeaderButton(page, "#source-mode-switch");
    const presentationFont = page.locator('#lyrics .source-presentation[data-font="missing-font"]').filter({ hasText: "Reader Smoke" });
    await presentationFont.waitFor({ state: "visible", timeout: 30_000 });
    await presentationFont.locator(".view-warning").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#lyrics").textContent() || "", /Reader Smoke/);
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#glyph-name").fill("missing-svg");
    await page.locator("#glyph-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /\[Reader Smoke:glyph=missing-svg\]/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator('#lyrics .source-presentation[data-glyph="missing-svg"][data-glyph-fallback="Reader Smoke"].glyph-failed').waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#lyrics").innerText(), /Reader Smoke/);
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });

    await selectLyricsText("Reader Smoke");
    await page.locator("#combine-mode").selectOption("z");
    await page.locator("#combine-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /\[Reader Smoke:combine=z\]/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator('#lyrics .source-presentation[data-combine="z"]').filter({ hasText: "Reader Smoke" }).waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#lyrics").textContent() || "", /Reader Smoke/);
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });

    await clickHeaderButton(page, "#source-mode-switch");
    assert.equal(await page.locator("#source-editor").inputValue(), clearedAuthorSource, "clearing Writer presentations must restore the original Author Source");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), clearedAuthorSource, "Viewer round-trip must preserve the exact Author Source");

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    const smokeRuby = page.locator('#lyrics .source-ruby').filter({ hasText: "はれ〴〵バネ" }).last();
    await selectTextIn(smokeRuby, "はれ〴〵バネ");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const rubyAuthorSource = await page.locator("#source-editor").inputValue();
    assert.match(rubyAuthorSource, /ruby-range=\d+-\d+,ruby-style=demo-chorus/, `Ruby presentation was not serialized: ${rubyAuthorSource.slice(-400)}`);
    await clickHeaderButton(page, "#source-mode-switch");
    const styledRubyParts = page.locator('.ruby-presentation-part[data-ruby-part="ruby"][data-style="demo-chorus"]');
    await styledRubyParts.first().waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await styledRubyParts.count(), 6, "Ruby presentation must cover each selected reading grapheme");
    await clickHeaderButton(page, "#mode-switch");
    await selectTextIn(page.locator('#lyrics .source-ruby').filter({ hasText: "はれ〴〵バネ" }).last(), "はれ〴〵バネ");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), clearedAuthorSource, "Ruby-only presentation clear must restore the original Author Source");

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    const smokeRubyBase = page.locator('#lyrics .source-ruby').filter({ hasText: "はれ〴〵バネ" }).last();
    await selectTextIn(smokeRubyBase, "晴々撥条");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const rubyBaseSource = await page.locator("#source-editor").inputValue();
    assert.match(rubyBaseSource, /base-range=0-4,base-style=demo-chorus|base-style=demo-chorus,base-range=0-4/, `Ruby Base presentation was not serialized: ${rubyBaseSource.slice(-400)}`);
    await clickHeaderButton(page, "#source-mode-switch");
    const styledRubyBaseParts = page.locator('.ruby-presentation-part[data-ruby-part="base"][data-style="demo-chorus"]');
    await styledRubyBaseParts.first().waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await styledRubyBaseParts.count(), 4, "Ruby Base presentation must cover each selected base grapheme");
    await clickHeaderButton(page, "#mode-switch");
    await selectTextIn(page.locator('#lyrics .source-ruby').filter({ hasText: "はれ〴〵バネ" }).last(), "晴々撥条");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), clearedAuthorSource, "Ruby Base presentation clear must restore the original Author Source");

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Writer Gate");
    await page.keyboard.insertText("Writer Beta");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /Writer Beta/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const wysiwygSource = await page.locator("#source-editor").inputValue();
    assert.match(wysiwygSource, /\[Writer Beta:style=demo-chorus\]/, `WYSIWYG text editing lost the existing Presentation: ${wysiwygSource.slice(-400)}`);
    assert.doesNotMatch(wysiwygSource, /\[Writer Gate:style=demo-chorus\]/, "WYSIWYG text editing must update the Author Source text");
    await page.locator("#source-editor").fill(clearedAuthorSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await placeCaretIn(page.locator("#lyrics"), "Writer Gate", 7);
    await page.keyboard.insertText("X");
    await clickHeaderButton(page, "#source-mode-switch");
    const caretSource = await page.locator("#source-editor").inputValue();
    assert.match(caretSource, /\[Writer XGate:style=demo-chorus\]/, `Caret input lost the existing Presentation: ${caretSource.slice(-500)}`);
    await page.locator("#source-editor").fill(clearedAuthorSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await placeCaretIn(page.locator("#lyrics"), "Writer Gate", 7);
    await page.keyboard.press("Enter");
    await clickHeaderButton(page, "#source-mode-switch");
    const newlineSource = await page.locator("#source-editor").inputValue();
    const newlinePortable = toPortableText(parseSource(newlineSource, canonicalAdapter), canonicalAdapter);
    assert.match(newlinePortable, /Writer \r?\nGate/, `WYSIWYG newline must become Portable Source text: ${newlineSource.slice(-500)}`);
    assert.match(newlineSource, /\[Writer .*style=demo-chorus\]\r?\n\[Gate:style=demo-chorus\]/, `WYSIWYG newline must retain the existing Presentation: ${newlineSource.slice(-500)}`);
    await page.locator("#source-editor").fill(clearedAuthorSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Writer Gate");
    await page.locator("#lyrics").evaluate(element => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? "Writer Paste" : "<strong>unsafe html</strong>" } });
      element.dispatchEvent(event);
    });
    await clickHeaderButton(page, "#source-mode-switch");
    const pasteSource = await page.locator("#source-editor").inputValue();
    assert.match(pasteSource, /\[Writer Paste:style=demo-chorus\]/, `Plain-text paste lost the existing Presentation: ${pasteSource.slice(-500)}`);
    assert.doesNotMatch(pasteSource, /unsafe html|<strong>/, "WYSIWYG paste must not import HTML into Author Source");
    await page.locator("#source-editor").fill(clearedAuthorSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Writer Gate");
    await page.keyboard.press("Backspace");
    await clickHeaderButton(page, "#source-mode-switch");
    const deleteSource = await page.locator("#source-editor").inputValue();
    assert.doesNotMatch(deleteSource, /Writer Gate/, `WYSIWYG deletion must remove the selected Author Source text: ${deleteSource.slice(-500)}`);
    assert.equal(await page.locator("#source-editor").getAttribute("aria-invalid"), null, "WYSIWYG deletion must keep the resulting Source parseable");
    await page.locator("#source-editor").fill(clearedAuthorSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    const originalTitle = (await page.locator("#song-title").innerText()).trim();
    await selectTextIn(page.locator("#song-title"), originalTitle);
    await page.keyboard.insertText("Writer Title");
    await clickHeaderButton(page, "#source-mode-switch");
    const titleSource = await page.locator("#source-editor").inputValue();
    assert.equal(titleSource.split(/\r?\n/, 1)[0], "Writer Title", `Title editing must update only the first Author Source line: ${titleSource.slice(0, 200)}`);
    assert.match(titleSource, /Writer Gate/, "Title editing must preserve the body Source");
    await page.locator("#source-editor").fill(clearedAuthorSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#outline-name").fill("thin");
    await page.locator("#outline-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    const outlineSource = await page.locator("#source-editor").inputValue();
    assert.match(outlineSource, /\[Reader Smoke:outline=thin\]/, `Outline authoring was not serialized: ${outlineSource.slice(-500)}`);
    await clickHeaderButton(page, "#source-mode-switch");
    const outlined = page.locator('#lyrics .source-presentation[data-outline="thin"]').filter({ hasText: "Reader Smoke" });
    await outlined.waitFor({ state: "visible", timeout: 30_000 });
    assert.ok(await outlined.evaluate(element => element.style.webkitTextStroke || element.style.textStroke || element.style.textShadow), "Outline authoring must reach the resolved viewer style");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("Reader Smoke");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });

    await page.locator("#source-editor").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n[Native Undo Gate]");
    await page.waitForFunction(() => /Native Undo Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), clearedAuthorSource, "Source Editor must retain the textarea native Undo path");

    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await setSettingsOpen(true);
    stage = "variant modernized baseline";
    await page.locator("#variant-mode").selectOption("modernized");
    const modernBaseline = await page.locator("#source-editor").inputValue();
    const modernBaselineCanonical = canonicalAuthorSource(modernBaseline);
    assert.match(modernBaseline, /組文字も/);
    await setSettingsOpen(true);
    stage = "variant modernized style";
    await selectLyricsText("組文字も");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    stage = "variant inspect edited modernized";
    await clickHeaderButton(page, "#source-mode-switch");
    const modernEdited = await page.locator("#source-editor").inputValue();
    assert.match(modernEdited, /\[組文字も:style=demo-chorus\]/, "WYSIWYG edits must target the active Variant Source");
    await setSettingsOpen(true);
    stage = "variant inspect original";
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), clearedAuthorSource, "editing another Variant must not leak into the original Source");
    stage = "variant restore modernized";
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value !== source, clearedAuthorSource, { timeout: 30_000 });
    assert.match(await page.locator("#source-editor").inputValue(), /\[組文字も:style=demo-chorus\]/, "Variant-specific WYSIWYG presentation must survive a Variant round-trip");
    await setSettingsOpen(true);
    stage = "variant clear modernized";
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await selectLyricsText("組文字も");
    await page.locator("#clear-presentation-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    diagnosticExpected = modernBaselineCanonical;
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, modernBaselineCanonical, { timeout: 30_000 });
    assert.equal(await page.locator("#source-editor").inputValue(), modernBaselineCanonical, "clearing Variant presentation must restore only that Variant Source");
    await setSettingsOpen(true);
    stage = "variant restore original";
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, clearedAuthorSource, { timeout: 30_000 });
    await setSettingsOpen(false);

    await page.screenshot({ path: screenshot, fullPage: false });
    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { status: "PASS", targetUrl, screenshot };
  } catch (error) {
    await page.screenshot({ path: path.join(outputRoot, "chromium-source-editor-failure.png"), fullPage: false }).catch(() => {});
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", invalid: document.querySelector("#source-editor")?.getAttribute("aria-invalid"), status: document.querySelector("#source-status")?.textContent || "", dirty: document.body.dataset.dirty || "" })).catch(() => ({}));
    const sourceTail = await page.locator("#source-editor").inputValue().catch(() => "");
    const expectedTail = diagnosticExpected ? ` expectedTail=${JSON.stringify(diagnosticExpected.slice(-500))}` : "";
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} sourceTail=${JSON.stringify(sourceTail.slice(-500))}${expectedTail} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Beta Gate failure::${message}`);
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

    stage = "variant source isolation";
    await clickHeaderButton(page, "#settings-toggle");
    assert.ok(await page.locator("#variant-mode option").count() >= 2, "Source Editor must expose the document Variant Set");
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /こちらへ来たのだろう/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const modernSource = await page.locator("#source-editor").inputValue();
    await page.locator("#source-editor").fill(`${modernSource}\n[Source Variant Gate:style=demo-chorus]`);
    await page.waitForFunction(() => /Source Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => /Source Variant Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("original");
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
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
    await page.locator("#source-editor").fill(originalSource);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source, originalSource, { timeout: 30_000 });
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
    ["writerSource", runWriterSourceGate],
    ["writerDocument", runWriterDocumentGate],
    ["writerWysiwyg", runWriterWysiwygGate],
    ["writerTab", runWriterTabGate],
    ["storageFailure", runStorageFailureGate],
    ["malformedDraft", runMalformedDraftGate]
  ];
  const { results, failed } = await runWriterGateSuite(gates, targetUrl);
  console.log(JSON.stringify(results, null, 2));
  if (failed) process.exitCode = 1;
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
