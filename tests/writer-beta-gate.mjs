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
  return /invalid\.example|missing-glyph\.svg/.test(url);
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
    assert.match(originalSource, /晴々撥条|如何《どう》/);

    const editedSource = `${originalSource}\n[Writer Gate:style=demo-chorus]`;
    await page.locator("#source-editor").fill(editedSource);
    await page.waitForFunction(() => document.body.dataset.dirty === "true");
    assert.match(await page.locator("#source-status").textContent() || "", /未保存/);

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

    await clickHeaderButton(page, "#mode-switch");
    await clickHeaderButton(page, "#settings-toggle");
    const remoteSourceUrl = `${new URL(targetUrl).origin}/data/demo/lyrics-historical.txt`;
    await page.locator("#source-url").fill(remoteSourceUrl);
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#url-open-button").click({ force: true });
    await page.waitForFunction(() => /曲前フリ/.test(document.querySelector("#song-title")?.textContent || ""), null, { timeout: 30_000 });
    assert.match(await page.locator("#source-status").textContent() || "", /URL本文を読み込みました/);
    await page.locator("#undo-button").click({ force: true });
    await clickHeaderButton(page, "#source-mode-switch");
    await page.waitForFunction(() => /Writer Gate/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    assert.match(await page.locator("#source-editor").inputValue(), /Writer Gate/);

    const invalidSource = `${editedSource}\n[x:base-range=0-3]`;
    await page.locator("#source-editor").fill(invalidSource);
    await page.waitForFunction(() => document.querySelector("#source-editor")?.getAttribute("aria-invalid") === "true");
    assert.match(await page.locator("#source-status").textContent() || "", /Sourceを反映できません/);
    assert.match(await page.locator("#source-status").textContent() || "", /行\d+・列\d+/);

    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible" });
    const viewerText = await page.locator("#lyrics").innerText();
    assert.match(viewerText, /Writer Gate/);
    assert.doesNotMatch(viewerText, /base-range=0-3/);
    assert.equal(await page.locator("#source-editor").getAttribute("aria-invalid"), null);

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

const local = requestedUrl ? null : await startLocalServer();
const targetUrl = requestedUrl || local.url;
try {
  console.log(JSON.stringify(await runGate(targetUrl), null, 2));
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
