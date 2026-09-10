import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.cwd());
const outputRoot = process.env.WRITER_GATE_OUTPUT || path.join(os.tmpdir(), "lyric-reader-writer-gate");
const requestedUrl = process.env.WRITER_GATE_URL?.trim();

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

    const secondTab = await context.newPage();
    try {
      await secondTab.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await secondTab.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      await secondTab.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
      const secondSource = await secondTab.locator("#source-editor").inputValue();
      await secondTab.locator("#source-editor").fill(`${secondSource}\n[Writer Gate:second-tab]`);
      await secondTab.waitForFunction(() => document.body.dataset.dirty === "true");
      const draftKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("lyric-reader:draft:")));
      const tabKeys = draftKeys.map(key => key.split(":tab:")[1]).filter(Boolean);
      assert.ok(tabKeys.length >= 2, "each Tab must create an independent Draft key");
      assert.equal(new Set(tabKeys).size, tabKeys.length, "Draft keys must not share a Tab identity");
    } finally {
      await secondTab.close();
    }

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

    await page.screenshot({ path: screenshot, fullPage: false });
    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { status: "PASS", targetUrl, screenshot };
  } catch (error) {
    await page.screenshot({ path: path.join(outputRoot, "chromium-source-editor-failure.png"), fullPage: false }).catch(() => {});
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", invalid: document.querySelector("#source-editor")?.getAttribute("aria-invalid"), status: document.querySelector("#source-status")?.textContent || "", dirty: document.body.dataset.dirty || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Beta Gate failure::${message}`);
    throw new Error(message);
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

const local = requestedUrl ? null : await startLocalServer();
const targetUrl = requestedUrl || local.url;
try {
  console.log(JSON.stringify({ writer: await runGate(targetUrl), storageFailure: await runStorageFailureGate(targetUrl) }, null, 2));
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
