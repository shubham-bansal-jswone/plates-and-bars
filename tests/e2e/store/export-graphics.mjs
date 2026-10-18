// On-demand export of the Play Store graphics (#833). Not a Playwright spec and not part of CI.
//   cd tests/e2e && npm ci && npm run install:chromium && (cd ../../apps/mobile && npm ci)
//   npm run store:graphics        # writes docs/store/feature-graphic.png (1024x500) and docs/store/store-icon.png (512x512)
// Chromium (open source) draws the SVGs. The two OFL fonts are embedded from the app's own font packages
// (@expo-google-fonts/roboto and /inter in apps/mobile/node_modules), so no font file is copied into the repo.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
  { svg: here('../../../apps/mobile/assets/brand/icon.svg'), png: 'store-icon.png', width: 512, height: 512, alpha: true } // Play documents a 32-bit PNG (with alpha) for the icon,
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: await chromiumPath() });
try {
  for (const { svg, png, width, height, alpha } of jobs) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    // Inline the SVG (an <img> would not see the page's @font-face) and size it to the output.
    const markup = readFileSync(svg, 'utf8').replace(/^<\?xml[^>]*>\s*/, '').replace(/(<svg\b[^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `$1 width="${width}" height="${height}"`);
    await page.setContent(`<style>${faces}html,body{margin:0;background:${alpha ? 'transparent' : '#fff'}}svg{display:block}</style>${markup}`);
    await page.evaluate(() => document.fonts.ready);
    if (alpha) {
      // A screenshot of an opaque page is encoded as 24-bit RGB. A canvas always encodes RGBA, so draw the SVG on one for the 32-bit icon.
      const b64 = await page.evaluate(
        ([w, h]) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              resolve(canvas.toDataURL('image/png').split(',')[1]);
            };
            img.onerror = reject;
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(document.querySelector('svg').outerHTML)}`;
          }),
        [width, height],
      );
      writeFileSync(`${outDir}/${png}`, Buffer.from(b64, 'base64'));
    } else {
      await page.locator('svg').screenshot({ path: `${outDir}/${png}` });
    }
    console.log(`wrote ${png} (${width}x${height})`);
    await page.close();
  }
} finally {
  await browser.close();
}
