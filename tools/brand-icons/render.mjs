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
// Splash: rounded brand tile on transparent, reads on both light (#FFFFFF) and dark (#000000) canvases.
const tile = await sharp(svg('icon.svg'), { density: 384 }).resize(640, 640).png().toBuffer();
const mask = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" rx="144"/></svg>');
const rounded = await sharp(tile).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: rounded, left: 192, top: 192 }]).png().toFile(join(assets, 'splash-icon.png'));
