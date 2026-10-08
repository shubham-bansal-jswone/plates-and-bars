// Serves dist/ on a local port and runs axe-core in headless Chrome on every built page,
// in light and dark colour schemes. Needs a local Chrome/Chromium (set CHROME_PATH if not found).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain" };
const pages = ["/", "/privacy/", "/terms/"];
const viewports = [{ width: 1280, height: 800 }, { width: 360, height: 740 }];

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));
if (!chrome) {
  console.error("No Chrome/Chromium found. Set CHROME_PATH.");
  process.exit(2);
}

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (p.endsWith("/")) p += "index.html";
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
let violations = 0;
for (const scheme of ["light", "dark"]) {
  for (const viewport of viewports) {
    for (const path of pages) {
      const page = await browser.newPage();
      await page.setViewport(viewport);
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
      await page.evaluate(axeSource);
      const result = await page.evaluate(() => globalThis.axe.run());
      for (const v of result.violations) {
        violations++;
        console.log(`[${scheme} ${viewport.width}px ${path}] ${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
      }
      console.log(`${scheme} ${viewport.width}px ${path}: ${result.violations.length} violations, ${result.passes.length} rules passed`);
      await page.close();
    }
  }
}
await browser.close();
server.close();
process.exit(violations ? 1 : 0);
