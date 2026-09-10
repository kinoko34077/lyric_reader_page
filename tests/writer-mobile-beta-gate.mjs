import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, devices, webkit } from "playwright";

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
