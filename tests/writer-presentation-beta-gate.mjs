import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { parseLyricContainer } from "../assets/js/lyric-container.js";

const root = path.resolve(process.cwd());
const outputRoot = process.env.WRITER_PRESENTATION_GATE_OUTPUT || path.join(os.tmpdir(), "lyric-reader-writer-presentation-gate");
const requestedUrl = process.env.WRITER_PRESENTATION_GATE_URL?.trim();

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

function withThemeFont(containerText, font) {
  const parsed = parseLyricContainer(containerText);
  const header = structuredClone(parsed.header);
  header.document.theme = { ...(header.document.theme || {}), font };
  return `LYRIC-READER/1\n${JSON.stringify(header)}\n\n${parsed.source}`;
}

async function clickHeaderButton(page, selector) {
  await page.evaluate(target => { document.body.classList.remove("chrome-hidden"); document.querySelector(target)?.click(); }, selector);
}

async function selectTextInRoot(locator, text) {
  return locator.evaluate((rootElement, value) => {
    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const source = nodes.map(node => node.nodeValue || "").join("");
    const start = source.indexOf(value);
    if (start < 0) return false;
    rootElement.focus?.();
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

async function waitForMode(page, mode) {
  await page.waitForFunction(expected => document.body.dataset.mode === expected, mode, { timeout: 30_000 });
}

async function toSource(page) {
  const mode = await page.evaluate(() => document.body.dataset.mode || "");
  if (mode !== "source") await clickHeaderButton(page, "#source-mode-switch");
  await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
  await waitForMode(page, "source");
}

async function toWriter(page) {
  let mode = await page.evaluate(() => document.body.dataset.mode || "");
  if (mode === "source") {
    await clickHeaderButton(page, "#source-mode-switch");
    await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
    await waitForMode(page, "viewer");
    mode = "viewer";
  }
  if (mode === "viewer") await clickHeaderButton(page, "#mode-switch");
  await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
  await waitForMode(page, "writer");
}

async function ensureSettingsOpen(page) {
  const hidden = await page.locator("#settings-panel").evaluate(element => element.hidden);
  if (hidden) await clickHeaderButton(page, "#settings-toggle");
  await page.waitForFunction(() => document.querySelector("#settings-panel")?.hidden === false, null, { timeout: 30_000 });
}

async function selectSeed(page) {
  const selected = await selectTextInRoot(page.locator("#lyrics"), "Presentation Gate Seed");
  assert.equal(selected, true, "Presentation Gate must find its unique seed text");
}

async function clearSeedPresentation(page) {
  await toWriter(page);
  await selectSeed(page);
  await page.locator("#clear-presentation-button").click({ force: true });
  await toSource(page);
  await page.waitForFunction(() => !/\[Presentation Gate Seed:/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
  const source = await page.locator("#source-editor").inputValue();
  assert.doesNotMatch(source, /\[Presentation Gate Seed:/, "clearing the seed must remove only its Presentation wrapper");
  return source;
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
  const screenshot = path.join(outputRoot, "chromium-writer-presentation.png");
  let stage = "initial";
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#source-editor").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /晴々撥条|如何《どう》/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    const originalSource = await page.locator("#source-editor").inputValue();
    const nishikiPreset = await page.locator('#font-family option[value="nishiki-teki"]').evaluate(option => ({ disabled: option.disabled, title: option.title }));
    if (nishikiPreset.disabled) assert.match(nishikiPreset.title, /実Font URL未設定/, "Unavailable Nishiki-teki must explain why it cannot be selected");
    else assert.match(nishikiPreset.title, /端末または登録済みWeb Font/, "A selectable Nishiki-teki preset must identify its resolved source");
    const seedSource = `${originalSource}\nPresentation Gate Seed`;
    await page.locator("#source-editor").fill(seedSource);
    await page.waitForFunction(() => /Presentation Gate Seed/.test(document.querySelector("#source-editor")?.value || ""), null, { timeout: 30_000 });
    await toWriter(page);
    assert.ok(await page.locator("#lyrics").textContent().then(text => text?.includes("Presentation Gate Seed")), "seed must render in Writer");

    stage = "document typography defaults";
    await ensureSettingsOpen(page);
    const dirtyBeforeTypography = await page.locator("body").getAttribute("data-dirty");
    await page.locator("#line-height-range").fill("1.4");
    await page.locator("#letter-spacing-range").fill("0.06");
    await page.locator("#paragraph-spacing-range").fill("0.8");
    assert.equal(await page.locator("body").getAttribute("data-dirty"), dirtyBeforeTypography, "Typography changes remain preference-only until explicitly saved");
    await page.locator("#document-typography-button").click({ force: true });
    await toSource(page);
    const typographyContainer = parseLyricContainer(await page.locator("#source-editor").inputValue());
    assert.deepEqual(typographyContainer.header.document.theme.typography, { lineHeight: 1.4, letterSpacing: 0.06, paragraphSpacing: 0.8 }, "explicit Writer action must persist typography in the document Theme");
    await toWriter(page);

    stage = "document Registry Font fallback";
    await toSource(page);
    const registryFontSource = withThemeFont(await page.locator("#source-editor").inputValue(), { type: "registry", name: "nishiki" });
    await page.locator("#source-editor").fill(registryFontSource);
    await page.waitForFunction(() => document.querySelector("#source-editor")?.value.includes('"type":"registry"'), null, { timeout: 30_000 });
    await toWriter(page);
    await ensureSettingsOpen(page);
    await page.locator("#document-defaults-button").click({ force: true });
    assert.equal(await page.locator('#font-family option[value="registry:nishiki"]').isDisabled(), false, "Registry Font must remain selectable when the asset is unavailable");
    assert.equal(await page.locator("#font-family").inputValue(), "registry:nishiki", "Document Theme Registry Font must select the resolved option");
    await page.waitForFunction(() => !getComputedStyle(document.documentElement).getPropertyValue("--reader-font").includes("ReaderFont-nishiki"), null, { timeout: 30_000 });
    await page.waitForFunction(() => /文書指定Fontを読み込めない/.test(document.querySelector("#source-status")?.textContent || ""), null, { timeout: 30_000 });
    assert.match(await page.locator("#lyrics").textContent() || "", /Presentation Gate Seed/, "Registry Font failure must keep Reader text visible");

    stage = "Style authoring";
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await toSource(page);
    let source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:style=demo-chorus\]/, "Style authoring must serialize into Author Source");
    await toWriter(page);
    await page.locator('#lyrics .source-presentation[data-style="demo-chorus"]').filter({ hasText: "Presentation Gate Seed" }).waitFor({ state: "visible", timeout: 30_000 });
    source = await clearSeedPresentation(page);

    stage = "Palette authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#palette-bank").selectOption("default");
    await page.locator("#palette-slot").selectOption("2");
    await page.locator("#apply-palette-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:[^\]]*c=2[^\]]*\]/, "Palette authoring must serialize its selected Slot");
    source = await clearSeedPresentation(page);

    stage = "Palette Bank authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#palette-bank").selectOption("night");
    await page.locator("#palette-slot").selectOption("2");
    await page.locator("#apply-palette-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:c=2,bank=night\]/, "Palette Bank authoring must preserve Bank and Slot");
    await toWriter(page);
    await page.locator('#lyrics .source-presentation[data-bank="night"][data-palette="2"]').filter({ hasText: "Presentation Gate Seed" }).waitFor({ state: "visible", timeout: 30_000 });
    await clearSeedPresentation(page);

    stage = "Font fallback authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#presentation-font-name").fill("missing-font");
    await page.locator("#presentation-font-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:font=missing-font\]/, "Font authoring must serialize into Author Source");
    await toWriter(page);
    const missingFont = page.locator('#lyrics .source-presentation[data-font="missing-font"]').filter({ hasText: "Presentation Gate Seed" });
    await missingFont.waitFor({ state: "visible", timeout: 30_000 });
    await missingFont.locator(".view-warning").waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await page.locator("#lyrics").textContent() || "", /Presentation Gate Seed/, "Font failure must keep the original text visible");
    await clearSeedPresentation(page);

    stage = "Glyph fallback authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#glyph-name").fill("missing-svg");
    await page.locator("#glyph-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:glyph=missing-svg\]/, "Glyph authoring must serialize into Author Source");
    await toWriter(page);
    const missingGlyph = page.locator('#lyrics .source-presentation[data-glyph="missing-svg"].glyph-failed').filter({ hasText: "Presentation Gate Seed" });
    await missingGlyph.waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await missingGlyph.innerText(), /Presentation Gate Seed/, "Glyph failure must fallback to the original text");
    await clearSeedPresentation(page);

    stage = "Combine authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#combine-mode").selectOption("z");
    await page.locator("#combine-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:combine=z\]/, "Combine authoring must serialize its mode");
    await toWriter(page);
    await page.locator('#lyrics .source-presentation[data-combine="z"]').filter({ hasText: "Presentation Gate Seed" }).waitFor({ state: "visible", timeout: 30_000 });
    await clearSeedPresentation(page);

    stage = "Outline authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#outline-name").fill("thin");
    await page.locator("#outline-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:outline=thin\]/, "Outline authoring must serialize into Author Source");
    await toWriter(page);
    const outlined = page.locator('#lyrics .source-presentation[data-outline="thin"]').filter({ hasText: "Presentation Gate Seed" });
    await outlined.waitFor({ state: "visible", timeout: 30_000 });
    assert.ok(await outlined.evaluate(element => element.style.webkitTextStroke || element.style.textStroke || element.style.textShadow), "Outline authoring must reach the resolved viewer style");
    await clearSeedPresentation(page);

    stage = "Ruby Reading authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    const ruby = page.locator("#lyrics .source-ruby").filter({ hasText: "はれ〴〵バネ" }).last();
    assert.equal(await selectTextInRoot(ruby, "はれ〴〵バネ"), true, "Ruby Reading target must be selectable");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /ruby-range=\d+-\d+,ruby-style=demo-chorus|ruby-style=demo-chorus,ruby-range=\d+-\d+/, "Ruby Reading authoring must serialize a scoped range");
    await toWriter(page);
    assert.ok(await page.locator('.ruby-presentation-part[data-ruby-part="ruby"][data-style="demo-chorus"]').count() > 0, "Ruby Reading Presentation must render");
    await selectTextInRoot(page.locator("#lyrics .source-ruby").filter({ hasText: "はれ〴〵バネ" }).last(), "はれ〴〵バネ");
    await page.locator("#clear-presentation-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.doesNotMatch(source, /ruby-style=demo-chorus/, "clearing Ruby Reading Presentation must remove only its scoped decoration");

    stage = "Ruby Base authoring";
    await toWriter(page);
    await ensureSettingsOpen(page);
    const rubyBase = page.locator("#lyrics .source-ruby").filter({ hasText: "はれ〴〵バネ" }).last();
    assert.equal(await selectTextInRoot(rubyBase, "晴々撥条"), true, "Ruby Base target must be selectable");
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /base-range=\d+-\d+,base-style=demo-chorus|base-style=demo-chorus,base-range=\d+-\d+/, "Ruby Base authoring must serialize a scoped range");
    await toWriter(page);
    assert.ok(await page.locator('.ruby-presentation-part[data-ruby-part="base"][data-style="demo-chorus"]').count() > 0, "Ruby Base Presentation must render");
    await selectTextInRoot(page.locator("#lyrics .source-ruby").filter({ hasText: "はれ〴〵バネ" }).last(), "晴々撥条");
    await page.locator("#clear-presentation-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.doesNotMatch(source, /base-style=demo-chorus/, "clearing Ruby Base Presentation must remove only its scoped decoration");

    stage = "multiple Style conflict";
    await toWriter(page);
    await ensureSettingsOpen(page);
    await selectSeed(page);
    await page.locator("#style-name").fill("demo-chorus");
    await page.locator("#style-button").click({ force: true });
    await selectSeed(page);
    await page.locator("#style-name").fill("demo-title");
    await page.locator("#style-button").click({ force: true });
    await toSource(page);
    source = await page.locator("#source-editor").inputValue();
    assert.match(source, /\[Presentation Gate Seed:style=demo-chorus,style=demo-title\]|\[Presentation Gate Seed:style=demo-title,style=demo-chorus\]/, "multiple Styles must remain visible in Author Source");
    await toWriter(page);
    const conflict = page.locator("#lyrics .source-presentation.presentation-conflict").filter({ hasText: "Presentation Gate Seed" });
    await conflict.waitFor({ state: "visible", timeout: 30_000 });
    await conflict.locator(".view-warning").waitFor({ state: "visible", timeout: 30_000 });
    await clearSeedPresentation(page);

    await page.screenshot({ path: screenshot, fullPage: false });
    assert.deepEqual({ consoleErrors, pageErrors, failedRequests, badResponses }, { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] });
    return { status: "PASS", targetUrl, screenshot };
  } catch (error) {
    await page.screenshot({ path: path.join(outputRoot, "chromium-writer-presentation-failure.png"), fullPage: false }).catch(() => {});
    const state = await page.evaluate(() => ({ mode: document.body.dataset.mode || "", source: document.querySelector("#source-editor")?.value || "", viewer: document.querySelector("#lyrics")?.innerText || "" })).catch(() => ({}));
    const message = `${error instanceof Error ? error.message : String(error)} stage=${stage} state=${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)} page=${JSON.stringify(pageErrors)} failed=${JSON.stringify(failedRequests)} responses=${JSON.stringify(badResponses)}`.replace(/[\r\n]+/g, " ");
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Writer Presentation Gate failure::${message}`);
    throw new Error(message);
  } finally {
    await context.close();
    await browser.close();
  }
}

const local = requestedUrl ? null : await startLocalServer();
const targetUrl = requestedUrl || local.url;
try {
  try {
    console.log(JSON.stringify(await runGate(targetUrl), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ status: "FAIL", targetUrl, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
} finally {
  if (local) await new Promise(resolve => local.server.close(resolve));
}
