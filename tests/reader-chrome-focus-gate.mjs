import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.cwd());
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function serveLocalFile(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1/").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad URL");
    return;
  }
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream",
  });
  createReadStream(file).pipe(response);
}

const server = createServer(serveLocalFile);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
const targetUrl = `http://127.0.0.1:${address.port}/?mode=viewer`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "ja-JP" });

try {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("#lyrics").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector("#lyrics")?.childElementCount > 0, null, { timeout: 30_000 });

  await page.evaluate(() => {
    const shell = document.querySelector("#reader-shell");
    shell?.dispatchEvent(new Event("scroll"));
  });
  await page.waitForFunction(() => document.body.classList.contains("chrome-hidden"), null, { timeout: 3_000 });

  await page.locator("#settings-toggle").focus();
  await page.waitForTimeout(350);

  const focused = await page.locator("#settings-toggle").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      active: document.activeElement === element,
      visible: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
      chromeHidden: document.body.classList.contains("chrome-hidden"),
    };
  });
  assert.deepEqual(
    focused,
    { active: true, visible: true, chromeHidden: true },
    "focused chrome control must be visible while the reader auto-hide state remains active",
  );
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
