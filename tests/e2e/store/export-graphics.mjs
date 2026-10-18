// On-demand export of the Play Store graphics (#833). Not a Playwright spec and not part of CI.
//   cd tests/e2e && npm ci && npm run install:chromium && (cd ../../apps/mobile && npm ci)
//   npm run store:graphics        # writes docs/store/feature-graphic.png (1024x500) and docs/store/store-icon.png (512x512)
// Chromium (open source) draws the SVGs. The two OFL fonts are embedded from the app's own font packages
// (@expo-google-fonts/roboto and /inter in apps/mobile/node_modules), so no font file is copied into the repo.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { getInstalledBrowsers } from '@puppeteer/browsers';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const outDir = process.env.STORE_OUT ?? here('../../../docs/store');
const font = (pkg, file) => readFileSync(here(`../../../apps/mobile/node_modules/@expo-google-fonts/${pkg}/${file}`)).toString('base64');
const faces = [
  ['Roboto', 300, font('roboto', '300Light/Roboto_300Light.ttf')],
  ['Inter', 500, font('inter', '500Medium/Inter_500Medium.ttf')],
]
  .map(([family, weight, b64]) => `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format('truetype')}`)
  .join('');

async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const [installed] = await getInstalledBrowsers({ cacheDir: here('../.chromium/') });
  if (installed) return installed.executablePath;
  throw new Error('No Chromium found. Run `npm run install:chromium` or set CHROME_PATH.');
}

const jobs = [
  { svg: here('../../../docs/store/feature-graphic.svg'), png: 'feature-graphic.png', width: 1024, height: 500 },
  { svg: here('../../../apps/mobile/assets/brand/icon.svg'), png: 'store-icon.png', width: 512, height: 512 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromiumPath() });
try {
  for (const { svg, png, width, height } of jobs) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    // Inline the SVG (an <img> would not see the page's @font-face) and size it to the output.
    const markup = readFileSync(svg, 'utf8').replace(/^<\?xml[^>]*>\s*/, '').replace(/<svg /, `<svg width="${width}" height="${height}" `).replace(/ width="\d+" height="\d+"(?= width=)/, '');
    await page.setContent(`<style>${faces}html,body{margin:0;background:#fff}svg{display:block}</style>${markup}`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('svg').screenshot({ path: `${outDir}/${png}` });
    console.log(`wrote ${png} (${width}x${height})`);
    await page.close();
  }
} finally {
  await browser.close();
}
