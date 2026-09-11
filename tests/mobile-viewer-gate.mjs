import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, devices, webkit } from "playwright";

const root = path.resolve(process.cwd());
const outputRoot = process.env.MOBILE_GATE_OUTPUT || path.join(os.tmpdir(), "lyric-reader-mobile-gate");
const requestedUrl = process.env.MOBILE_GATE_URL?.trim();

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
  return { server, url: `http://127.0.0.1:${address.port}/?mode=viewer` };
}

function expectedAssetFailure(url) {
  return /invalid\.example|missing-glyph\.svg/.test(url);
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

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector("#lyrics")?.childElementCount > 0, null, { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('[data-glyph="missing-svg"].glyph-failed'), null, { timeout: 10_000 });
    await page.screenshot({ path: `${screenshotBase}-horizontal.png`, fullPage: false });

    const initial = await page.evaluate(() => ({
      title: document.querySelector("#song-title")?.textContent || "",
      body: document.querySelector("#lyrics")?.textContent || "",
      rubyCount: document.querySelectorAll("#lyrics ruby").length,
      rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      styleCount: document.querySelectorAll('#lyrics [data-style="demo-title"]').length,
      paletteCount: document.querySelectorAll('#lyrics [data-palette="2"]').length,
      outlineCount: document.querySelectorAll('#lyrics [data-outline="thin"]').length,
      parallelCount: document.querySelectorAll("#lyrics .combine-parallel").length,
      zCount: document.querySelectorAll("#lyrics .combine-z").length,
      glyphFallbackCount: document.querySelectorAll('#lyrics [data-glyph="missing-svg"].glyph-failed').length,
      fontFallbackCount: document.querySelectorAll('#lyrics [data-glyph="font-hare"].glyph-failed').length,
      warningCount: document.querySelectorAll("#lyrics .view-warning").length,
      defaultTypography: {
        lineHeight: getComputedStyle(document.documentElement).getPropertyValue("--reader-line-height").trim(),
        letterSpacing: getComputedStyle(document.documentElement).getPropertyValue("--reader-letter-spacing").trim(),
        paragraphSpacing: getComputedStyle(document.documentElement).getPropertyValue("--reader-paragraph-spacing").trim()
      }
    }));
    assert.ok(initial.title && initial.body, `${scenario.id}: title/body must render`);
    assert.ok(initial.rubyCount > 0, `${scenario.id}: Ruby must render`);
    assert.equal(initial.rootOverflow, false, `${scenario.id}: unexpected document horizontal overflow`);
    assert.ok(initial.styleCount > 0, `${scenario.id}: Style presentation must render`);
    assert.ok(initial.paletteCount > 0, `${scenario.id}: Palette presentation must render`);
    assert.ok(initial.outlineCount > 0, `${scenario.id}: Outline presentation must render`);
    assert.ok(initial.parallelCount > 0 && initial.zCount > 0, `${scenario.id}: Combine modes must render`);
    assert.ok(initial.glyphFallbackCount > 0 && initial.fontFallbackCount > 0, `${scenario.id}: failed Glyph/Font must fallback`);
    assert.ok(initial.warningCount > 0, `${scenario.id}: fallback warning must be visible`);
    assert.deepEqual(initial.defaultTypography, { lineHeight: "1.65", letterSpacing: ".02em", paragraphSpacing: ".4em" }, `${scenario.id}: mobile default typography must stay compact`);

    await page.locator("#settings-toggle").click();
    const settings = await page.locator("#settings-panel").evaluate(element => { const rect = element.getBoundingClientRect(); return { visible: rect.width > 0 && rect.height > 0, withinViewport: rect.left >= -2 && rect.right <= innerWidth + 2 && rect.top >= -2 && rect.bottom <= innerHeight + 2, scrollable: element.scrollHeight > element.clientHeight }; });
    assert.equal(settings.visible, true, `${scenario.id}: settings must be visible`);
    assert.equal(settings.withinViewport, true, `${scenario.id}: settings must stay in viewport`);
    assert.equal(settings.scrollable, true, `${scenario.id}: settings must be independently scrollable`);

    await page.locator("#size-select").selectOption("24");
    await page.waitForFunction(() => document.querySelector("#size-range")?.value === "24" && document.querySelector("#size-value")?.textContent === "24px");
    const sizeState = await page.evaluate(() => ({
      css: getComputedStyle(document.documentElement).getPropertyValue("--reader-size").trim(),
      select: document.querySelector("#size-select")?.value || "",
      range: document.querySelector("#size-range")?.value || ""
    }));
    assert.deepEqual(sizeState, { css: "24px", select: "24", range: "24" }, `${scenario.id}: size controls must stay synchronized`);

    await page.locator("#line-height-range").fill("1.5");
    await page.locator("#letter-spacing-range").fill("0.08");
    await page.locator("#paragraph-spacing-range").fill("0.5");
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--reader-line-height").trim() === "1.5" && getComputedStyle(document.documentElement).getPropertyValue("--reader-letter-spacing").trim() === "0.08em" && getComputedStyle(document.documentElement).getPropertyValue("--reader-paragraph-spacing").trim() === "0.5em");
    const typographyState = await page.evaluate(() => ({
      lineHeight: getComputedStyle(document.documentElement).getPropertyValue("--reader-line-height").trim(),
      letterSpacing: getComputedStyle(document.documentElement).getPropertyValue("--reader-letter-spacing").trim(),
      paragraphSpacing: getComputedStyle(document.documentElement).getPropertyValue("--reader-paragraph-spacing").trim(),
      dirty: document.body.dataset.dirty
    }));
    assert.deepEqual(typographyState, { lineHeight: "1.5", letterSpacing: "0.08em", paragraphSpacing: "0.5em", dirty: "false" }, `${scenario.id}: Viewer typography overrides must not dirty the Document`);

    await page.locator("#settings-toggle").click();
    await page.evaluate(() => {
      document.body.classList.add("chrome-hidden");
      document.querySelector("#lyrics")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    });
    await page.waitForFunction(() => !document.body.classList.contains("chrome-hidden"));
    await page.locator("#settings-toggle").click();

    await page.locator("#variant-mode").selectOption("modernized");
    await page.waitForFunction(() => document.querySelector("#variant-mode")?.value === "modernized");
    assert.match(await page.locator("#lyrics").innerText(), /どうしてこちらへ来たのだろう/);
    await page.locator("#variant-mode").selectOption("original");

    await page.locator("#vertical-toggle").check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#song-title")).writingMode === "vertical-rl" && getComputedStyle(document.querySelector("#lyrics")).writingMode === "vertical-rl");
    const vertical = await page.evaluate(() => {
      const root = document.querySelector("#lyrics");
      const overlapArea = (left, right) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      const textUnits = node => {
        const units = [...(node.nodeValue || "")]; const offsets = [0];
        for (const unit of units) offsets.push(offsets.at(-1) + unit.length);
        return { units, offsets };
      };
      const rangeRect = (node, start, end) => { const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end); return range.getBoundingClientRect(); };
      const repeatMarks = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode; const { units, offsets } = textUnits(node);
        for (const mark of ["〳〵", "〴〵"]) {
          for (let index = 0; index <= units.length - mark.length; index++) {
            if (units.slice(index, index + mark.length).join("") !== mark) continue;
            const previous = index > 0 ? rangeRect(node, offsets[index - 1], offsets[index]) : null;
            const first = rangeRect(node, offsets[index], offsets[index + 1]);
            const second = rangeRect(node, offsets[index + 1], offsets[index + 2]);
            const next = index + mark.length < units.length ? rangeRect(node, offsets[index + mark.length], offsets[index + mark.length + 1]) : null;
            repeatMarks.push({ mark, overlapBefore: previous ? Math.max(overlapArea(previous, first), overlapArea(previous, second)) : 0, overlapAfter: next ? Math.max(overlapArea(next, first), overlapArea(next, second)) : 0 });
          }
        }
      }
      const repeatAdvance = [...root.querySelectorAll(".repeat-mark-pair")].map(mark => ({ advance: mark.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(mark).fontSize) || 0 }));
      return { rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2, titleMode: getComputedStyle(document.querySelector("#song-title")).writingMode, bodyMode: getComputedStyle(root).writingMode, bodyHeight: root.getBoundingClientRect().height, repeatMarks, repeatAdvance };
    });
    assert.equal(vertical.rootOverflow, false, `${scenario.id}: vertical mode must not create document overflow`);
    assert.equal(vertical.titleMode, "vertical-rl", `${scenario.id}: title writing mode must follow body`);
    assert.equal(vertical.bodyMode, "vertical-rl", `${scenario.id}: body writing mode must be vertical`);
    assert.ok(vertical.bodyHeight > 0, `${scenario.id}: vertical body must remain visible`);
    assert.ok(vertical.repeatMarks.length > 0, `${scenario.id}: vertical fixture must exercise repeat marks`);
    assert.equal(vertical.repeatMarks.some(sample => sample.overlapBefore > 0.25 || sample.overlapAfter > 0.25), false, `${scenario.id}: vertical repeat marks must not overlap adjacent glyphs: ${JSON.stringify(vertical.repeatMarks.filter(sample => sample.overlapBefore > 0.25 || sample.overlapAfter > 0.25).slice(0, 4))}`);
    assert.equal(vertical.repeatAdvance.some(sample => sample.advance < sample.fontSize * 1.5), false, `${scenario.id}: vertical repeat marks must retain roughly two inline cells: ${JSON.stringify(vertical.repeatAdvance)}`);
    await page.screenshot({ path: `${screenshotBase}-vertical.png`, fullPage: false });

    await page.locator("#copy-all-button").click();
    let copied = "";
    try { copied = await page.evaluate(() => navigator.clipboard.readText()); } catch { /* Clipboard permission is browser-dependent. */ }
    if (copied) assert.match(copied, /氣乘ノ理|どう/);
    else {
      await page.waitForFunction(() => /コピー|選択/.test(document.querySelector("#source-status")?.textContent || ""), null, { timeout: 5_000 });
      assert.match(await page.locator("#source-status").textContent() || "", /コピー|選択/);
    }
    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { id: scenario.id, status: "PASS", screenshot: screenshotBase, initial, vertical };
  } catch (error) {
    await page.screenshot({ path: `${screenshotBase}-failure.png`, fullPage: false }).catch(() => {});
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", lyricsHidden: document.querySelector("#lyrics")?.hidden ?? null, status: document.querySelector("#source-status")?.textContent || "" })).catch(() => ({}));
    const message = `${scenario.id}: ${error instanceof Error ? error.message : String(error)} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Mobile Viewer Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

const local = requestedUrl ? null : await startLocalServer();
const targetUrl = requestedUrl || local.url;
const scenarios = [
  { id: "chromium-pixel-5", browser: chromium, device: devices["Pixel 5"] },
  { id: "webkit-iphone-13", browser: webkit, device: devices["iPhone 13"] }
];
const results = [];
try {
  for (const scenario of scenarios) results.push(await checkScenario(scenario, targetUrl));
  console.log(JSON.stringify({ targetUrl, results }, null, 2));
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
