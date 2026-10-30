// Regenerates fixtures/nutrition-label.png, the test image for label-specs/label.spec.mjs. The label is our own invention (a made-up
// product, plain black text on white, drawn from the HTML below), so no third-party image is in the repo. Not run by CI: the PNG is
// committed. Run with `node scripts/make-label-image.mjs` after `npm run install:chromium` (or with CHROME_PATH set).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getInstalledBrowsers } from '@puppeteer/browsers';
import { chromium } from '@playwright/test';

const rows = [
  ['Energy', '1620 kJ / 389 kcal'],
  ['Fat', '7.0 g'],
  ['of which saturates', '1.2 g'],
  ['Carbohydrate', '66.0 g'],
  ['of which sugars', '4.5 g'],
  ['Fibre', '9.5 g'],
  ['Protein', '12.5 g'],
  ['Salt', '0.02 g'],
];
const html = `<!doctype html><body style="margin:0;background:#fff;color:#000;font:36px/1.5 Arial,Helvetica,sans-serif">
<div style="width:900px;padding:24px;box-sizing:border-box">
<div style="font-size:44px;font-weight:bold">Nutrition Information</div>
<div style="font-size:34px;margin-bottom:8px">Typical values per 100 g</div>
<table style="width:100%;border-collapse:collapse">${rows
  .map(([k, v]) => `<tr style="border-top:2px solid #000"><td style="padding:4px 0">${k}</td><td style="text-align:right">${v}</td></tr>`)
  .join('')}</table></div></body>`;

const executablePath =
  process.env.CHROME_PATH ?? (await getInstalledBrowsers({ cacheDir: fileURLToPath(new URL('../.chromium/', import.meta.url)) }))[0]?.executablePath;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 900, height: 200 }, deviceScaleFactor: 1 });
await page.setContent(html);
writeFileSync(fileURLToPath(new URL('../fixtures/nutrition-label.png', import.meta.url)), await page.screenshot({ fullPage: true }));
await browser.close();
