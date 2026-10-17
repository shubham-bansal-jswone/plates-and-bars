// Dev-only: renders the Expo icon PNGs from apps/mobile/assets/brand/*.svg.
// Usage: from a temp dir with `npm i sharp` (Apache-2.0, not a repo dependency):
//   NODE_PATH=<tmp>/node_modules node tools/brand-icons/render.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [process.env.NODE_PATH ?? '.'] }));
const assets = join(dirname(fileURLToPath(import.meta.url)), '../../apps/mobile/assets');
const svg = (name) => readFileSync(join(assets, 'brand', name));
const render = (name, size, out) =>
  sharp(svg(name), { density: 384 }).resize(size, size).png().toFile(join(assets, out));

await sharp(svg('icon.svg'), { density: 384 }).resize(1024, 1024).flatten({ background: '#2457E6' }).removeAlpha().png().toFile(join(assets, 'icon.png'));
await render('foreground.svg', 512, 'android-icon-foreground.png');
await render('monochrome.svg', 432, 'android-icon-monochrome.png');
await render('icon.svg', 48, 'favicon.png');
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2457E6' } })
  .png().toFile(join(assets, 'android-icon-background.png'));
// Splash: brand-blue circle holding the (safe-zone scaled) mark. Android 12+ crops the splash icon to a circle,
// and the circle reads on both the white and black splash backgrounds.
const fg = await sharp(svg('foreground.svg'), { density: 384 }).resize(1024, 1024).png().toBuffer();
const circle = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="512" fill="#2457E6"/></svg>');
await sharp(circle).composite([{ input: fg }]).png().toFile(join(assets, 'splash-icon.png'));
