import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, devices, webkit } from "playwright";
import { containerToReaderDocument, parseLyricContainer, serializeLyricContainer } from "../assets/js/lyric-container.js";

const root = path.resolve(process.cwd());
const outputRoot = process.env.WRITER_MOBILE_GATE_OUTPUT || path.join(os.tmpdir(), "lyric-reader-writer-mobile-gate");
const requestedUrl = process.env.WRITER_MOBILE_GATE_URL?.trim();

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
  return { server, url: `http://127.0.0.1:${address.port}/?mode=writer` };
}

function expectedAssetFailure(url) {
  return /invalid\.example|missing-glyph\.svg|missing-reader\.txt/.test(url);
}

async function clickHeaderButton(page, selector) {
  await page.evaluate(target => { document.body.classList.remove("chrome-hidden"); document.querySelector(target)?.click(); }, selector);
}

function containerWithActiveSource(containerText, source) {
  const parsed = parseLyricContainer(containerText);
  const document = containerToReaderDocument(parsed);
  document.content.variants = document.content.variants.map(variant => variant.id === parsed.activeVariantId ? { ...variant, source: { text: source, url: "container:" } } : variant);
  return serializeLyricContainer(document, parsed.activeVariantId);
}

async function selectTextInRoot(locator, text) {
  return locator.evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const source = nodes.map(node => node.nodeValue || "").join(""); const start = source.indexOf(value);
    if (start < 0) return false;
    let cursor = 0; const point = offset => { for (const node of nodes) { const length = node.nodeValue?.length || 0; if (offset <= cursor + length) return [node, offset - cursor]; cursor += length; } const last = nodes.at(-1); return [last, last?.nodeValue?.length || 0]; };
    const range = document.createRange(); const [startNode, startOffset] = point(start); cursor = 0; const [endNode, endOffset] = point(start + value.length); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); document.dispatchEvent(new Event("selectionchange")); return true;
  }, text);
}

async function placeCaretBeforeRuby(page, index) {
  return page.locator("#lyrics .source-ruby").nth(index).evaluate(node => { const range = document.createRange(); range.setStartBefore(node); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); node.parentElement?.focus(); document.dispatchEvent(new Event("selectionchange")); return true; });
}

async function placeCaretInRoot(locator, text, offset) {
  return locator.evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const source = nodes.map(node => node.nodeValue || "").join(""); const start = source.indexOf(value.text);
    if (start < 0 || value.offset < 0 || value.offset > value.text.length) return false;
    root.focus(); let cursor = 0; const target = start + value.offset;
    for (const node of nodes) {
      const length = node.nodeValue?.length || 0;
      if (target >= cursor && target <= cursor + length) {
        const range = document.createRange(); range.setStart(node, target - cursor); range.collapse(true);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); document.dispatchEvent(new Event("selectionchange")); return true;
      }
      cursor += length;
    }
    return false;
  }, { text, offset });
}

async function placeCaretAtRootBoundary(locator, end = false) {
  return locator.evaluate((root, atEnd) => { root.focus(); const range = document.createRange(); range.selectNodeContents(root); range.collapse(Boolean(atEnd)); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); document.dispatchEvent(new Event("selectionchange")); return true; }, end);
}

async function checkScenario(scenario, targetUrl) {
  const browser = await scenario.browser.launch({ headless: true });
  const context = await browser.newContext({ ...scenario.device, locale: "ja-JP", colorScheme: "light" });
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
  const screenshotBase = path.join(outputRoot, scenario.id);
  await mkdir(outputRoot, { recursive: true });
  let stage = "initial";

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => document.body.dataset.mode === "writer" && document.querySelector("#lyrics")?.childElementCount > 0, null, { timeout: 30_000 });
    const initial = await page.evaluate(() => ({
      mode: document.body.dataset.mode || "",
      title: document.querySelector("#song-title")?.textContent || "",
      body: document.querySelector("#lyrics")?.textContent || "",
      titleEditable: document.querySelector("#song-title")?.contentEditable || "",
      bodyEditable: document.querySelector("#lyrics")?.contentEditable || "",
      sourceHidden: document.querySelector("#source-editor")?.hidden ?? true,
      rubyCount: document.querySelectorAll("#lyrics ruby").length,
      rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    }));
    assert.equal(initial.mode, "writer", `${scenario.id}: URL must enter Writer mode`);
    assert.ok(initial.title && initial.body, `${scenario.id}: Writer title/body must render`);
    assert.equal(initial.titleEditable, "true", `${scenario.id}: title must be contenteditable in Writer`);
    assert.equal(initial.bodyEditable, "true", `${scenario.id}: body must be contenteditable in Writer`);
    assert.equal(initial.sourceHidden, true, `${scenario.id}: Source Editor must stay hidden in Writer mode`);
    assert.ok(initial.rubyCount > 0, `${scenario.id}: Ruby must render in Writer`);
    assert.equal(initial.rootOverflow, false, `${scenario.id}: Writer must not create document overflow`);
    await page.screenshot({ path: `${screenshotBase}-horizontal.png`, fullPage: false });

    stage = "settings and variant controls";
    await clickHeaderButton(page, "#settings-toggle");
    const settings = await page.locator("#settings-panel").evaluate(element => { const rect = element.getBoundingClientRect(); return { visible: rect.width > 0 && rect.height > 0, withinViewport: rect.left >= -2 && rect.right <= innerWidth + 2 && rect.top >= -2 && rect.bottom <= innerHeight + 2, scrollable: element.scrollHeight > element.clientHeight }; });
    assert.equal(settings.visible, true, `${scenario.id}: Writer settings must be visible`);
    assert.equal(settings.withinViewport, true, `${scenario.id}: Writer settings must stay in viewport`);
    assert.equal(settings.scrollable, true, `${scenario.id}: Writer settings must be independently scrollable`);
    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => document.querySelector("#variant-mode")?.value === "modernized" && /どうしてこちらへ来たのだろう/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await page.locator("#variant-mode").selectOption("original");
    await page.locator("#ruby-toggle").uncheck();
    await page.waitForFunction(() => document.querySelectorAll("#lyrics ruby").length === 0, null, { timeout: 30_000 });
    await page.locator("#ruby-toggle").check();
    await page.waitForFunction(() => document.querySelectorAll("#lyrics ruby").length > 0, null, { timeout: 30_000 });
    assert.equal(await page.locator("body").getAttribute("data-dirty"), "false", `${scenario.id}: mobile view controls must not dirty the Document`);

    stage = "vertical Writer layout";
    await page.locator("#vertical-toggle").check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#song-title")).writingMode === "vertical-rl" && getComputedStyle(document.querySelector("#lyrics")).writingMode === "vertical-rl", null, { timeout: 30_000 });
    const vertical = await page.evaluate(() => ({
      titleMode: getComputedStyle(document.querySelector("#song-title")).writingMode,
      bodyMode: getComputedStyle(document.querySelector("#lyrics")).writingMode,
      rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      bodyHeight: document.querySelector("#lyrics")?.getBoundingClientRect().height || 0
    }));
    assert.equal(vertical.titleMode, "vertical-rl", `${scenario.id}: Writer title writing mode must follow body`);
    assert.equal(vertical.bodyMode, "vertical-rl", `${scenario.id}: Writer body must be vertical`);
    assert.equal(vertical.rootOverflow, false, `${scenario.id}: vertical Writer must not create document overflow`);
    assert.ok(vertical.bodyHeight > 0, `${scenario.id}: vertical Writer body must remain visible`);
    await page.screenshot({ path: `${screenshotBase}-vertical.png`, fullPage: false });

    stage = "Source and Viewer mode round trip";
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    assert.ok((await page.locator("#source-editor").inputValue()).length > 0, `${scenario.id}: Source mode must retain Author Source`);
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => document.body.dataset.mode === "viewer" && document.querySelector("#lyrics")?.contentEditable === "false", null, { timeout: 30_000 });
    await clickHeaderButton(page, "#mode-switch");
    await page.waitForFunction(() => document.body.dataset.mode === "writer" && document.querySelector("#lyrics")?.contentEditable === "true", null, { timeout: 30_000 });

    stage = "Title/body boundary on mobile Writer";
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();

    stage = "IME composition on mobile Writer";
    const dispatchCompositionWithoutFinalInput = async (locator, data) => locator.evaluate((root, value) => {
      root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode) throw new Error("mobile composition fixture has no text node");
      textNode.nodeValue += value;
      root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: value }));
      root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: value }));
    }, data);
    const readMobileSource = async () => {
      await clickHeaderButton(page, "#source-mode-switch");
      await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
      return parseLyricContainer(await page.locator("#source-editor").inputValue()).source;
    };
    const compositionFixture = containerWithActiveSource(originalSource, "Mobile IME\n本文");
    await page.locator("#source-editor").fill(compositionFixture);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", compositionFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await placeCaretAtRootBoundary(page.locator("#song-title"), true);
    await dispatchCompositionWithoutFinalInput(page.locator("#song-title"), "かな");
    await page.waitForFunction(() => /Mobile IMEかな/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    assert.equal((await readMobileSource()).split(/\r?\n/, 1)[0], "Mobile IMEかな", `${scenario.id}: WebKit compositionend must commit title text without a trailing input event`);
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#source-editor").fill(compositionFixture);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", compositionFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await dispatchCompositionWithoutFinalInput(page.locator("#lyrics"), "かな");
    await page.waitForFunction(() => /本文かな/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    assert.equal(await readMobileSource(), "Mobile IME\n本文かな", `${scenario.id}: WebKit compositionend must commit body text without a trailing input event`);

    stage = "Title/body boundary on mobile Writer";
    const boundaryFixture = containerWithActiveSource(originalSource, "Mobile Boundary\n本文");
    await page.locator("#source-editor").fill(boundaryFixture);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", boundaryFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await placeCaretAtRootBoundary(page.locator("#song-title"), true);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.id === "lyrics", null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(parseLyricContainer(await page.locator("#source-editor").inputValue()).source, "Mobile Boundary\n本文", `${scenario.id}: Title Enter must keep the canonical Source on mobile`);
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").fill(boundaryFixture);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", boundaryFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await placeCaretAtRootBoundary(page.locator("#lyrics"), false);
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() => document.activeElement?.id === "song-title", null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(parseLyricContainer(await page.locator("#source-editor").inputValue()).source, "Mobile Boundary\n本文", `${scenario.id}: Body Backspace must keep the canonical Source on mobile`);
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");

    stage = "Ruby preservation on mobile Writer";
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    const rubyFixture = containerWithActiveSource(originalSource, "Ruby Mobile Gate\n前｜読確認《よみかくにん》後\n前｜ペウコ《ピョコ》後");
    await page.locator("#source-editor").fill(rubyFixture);
    await page.waitForFunction(source => document.querySelector("#source-editor")?.value === source && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", rubyFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await page.locator("#lyrics .source-ruby").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#lyrics .source-ruby").first().evaluate(node => { const ruby = node.querySelector("ruby"); if (ruby) ruby.replaceWith(document.createTextNode(node.textContent || "")); });
    await page.locator("#lyrics").evaluate(root => { const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; const index = (node.nodeValue || "").indexOf("後"); if (index < 0) continue; const range = document.createRange(); range.setStart(node, index); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); root.focus(); document.dispatchEvent(new Event("selectionchange")); return; } });
    await page.keyboard.insertText("A");
    await page.waitForFunction(() => /A後/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    let source = await page.locator("#source-editor").inputValue();
    assert.match(source, /前｜読確認《よみかくにん》A後/, `${scenario.id}: flattened Ruby neighbor edit must preserve Ruby Source`);

    await page.locator("#source-editor").fill(rubyFixture);
    await page.waitForFunction(value => document.querySelector("#source-editor")?.value === value && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", rubyFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    await page.locator("#lyrics .source-ruby").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#lyrics .source-ruby").first().evaluate(node => { const ruby = node.querySelector("ruby"); if (ruby) ruby.replaceWith(document.createTextNode(node.textContent || "")); });
    await page.locator("#lyrics").evaluate(root => { const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; const index = (node.nodeValue || "").indexOf("後"); if (index < 0) continue; const range = document.createRange(); range.setStart(node, index); range.collapse(true); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); root.focus(); document.dispatchEvent(new Event("selectionchange")); return; } });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /読確認よみかくにん[\r\n]+後/.test(document.querySelector("#lyrics")?.innerText || ""), null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /前｜読確認《よみかくにん》\r?\n後/, `${scenario.id}: line break next to a flattened Ruby must preserve Ruby Source`);

    await page.locator("#source-editor").fill(rubyFixture);
    await page.waitForFunction(value => document.querySelector("#source-editor")?.value === value && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", rubyFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    assert.equal(await selectTextInRoot(page.locator("#lyrics .source-ruby").first(), "読確認よみかくにん"), true, `${scenario.id}: mobile Ruby selection must find the complete Ruby`);
    const copied = await page.locator("#lyrics").evaluate(element => { let value = ""; const event = new Event("copy", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { setData: (type, next) => { if (type === "text/plain") value = next; } } }); element.dispatchEvent(event); return value; });
    assert.equal(copied, "｜読確認《よみかくにん》", `${scenario.id}: mobile Ruby copy must use Portable Ruby text`);
    await placeCaretBeforeRuby(page, 1);
    await page.locator("#lyrics").evaluate((element, text) => { const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? text : "" } }); element.dispatchEvent(event); }, copied);
    await page.waitForFunction(() => (document.querySelectorAll("#lyrics .source-ruby").length || 0) >= 3, null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /前｜読確認《よみかくにん》｜ペウコ《ピョコ》後/, `${scenario.id}: mobile Portable Ruby paste must restore Ruby Source`);

    stage = "Portable Ruby paste at a normal text caret";
    await page.locator("#source-editor").fill(rubyFixture);
    await page.waitForFunction(value => document.querySelector("#source-editor")?.value === value && document.querySelector("#source-editor")?.getAttribute("aria-invalid") !== "true", rubyFixture, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    await clickHeaderButton(page, "#mode-switch");
    assert.equal(await placeCaretInRoot(page.locator("#lyrics"), "前", 1), true, `${scenario.id}: mobile normal-text caret must be placeable before Ruby`);
    await page.locator("#lyrics").evaluate((element, text) => { const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? text : "" } }); element.dispatchEvent(event); }, copied);
    await page.waitForFunction(() => (document.querySelectorAll("#lyrics .source-ruby").length || 0) >= 3, null, { timeout: 30_000 });
    await clickHeaderButton(page, "#source-mode-switch");
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /前｜読確認《よみかくにん》｜読確認《よみかくにん》後/, `${scenario.id}: mobile Portable Ruby paste at a normal text caret must use the semantic Source transaction`);

    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { id: scenario.id, status: "PASS", screenshot: screenshotBase, initial, vertical };
  } catch (error) {
    await page.screenshot({ path: `${screenshotBase}-failure.png`, fullPage: false }).catch(() => {});
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", lyricsHidden: document.querySelector("#lyrics")?.hidden ?? null, status: document.querySelector("#source-status")?.textContent || "" })).catch(() => ({}));
    const message = `${scenario.id}: ${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Mobile Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

const local = requestedUrl ? null : await startLocalServer();
const targetUrl = requestedUrl || local.url;
const scenarios = [
  { id: "chromium-pixel-5-writer", browser: chromium, device: devices["Pixel 5"] },
  { id: "webkit-iphone-13-writer", browser: webkit, device: devices["iPhone 13"] }
];
const results = [];
let failed = false;
try {
  for (const scenario of scenarios) {
    try { results.push(await checkScenario(scenario, targetUrl)); }
    catch (error) { failed = true; results.push({ id: scenario.id, status: "FAIL", targetUrl, error: error instanceof Error ? error.message : String(error) }); }
  }
  console.log(JSON.stringify({ targetUrl, results }, null, 2));
  if (failed) process.exitCode = 1;
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
