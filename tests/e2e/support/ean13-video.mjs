import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fake camera clip for Chromium (--use-file-for-fake-video-capture): one EAN-13 barcode, black bars on white, as raw YUV4MPEG2.
// Written to a temporary folder when the Playwright config loads, so no binary is committed.

/** The code in the fake camera clip: a valid EAN-13 (the GS1 check digit is right). */
export const BARCODE = '5000112637922';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The 95 modules of an EAN-13 (1 = bar) for 13 digits. */
export function ean13Modules(code) {
  if (!/^[0-9]{13}$/.test(code)) throw new Error('an EAN-13 has 13 digits');
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  const left = d.slice(1, 7).map((n, i) => (parity[i] === 'L' ? L[n] : G[n])).join('');
  const right = d.slice(7).map((n) => R[n]).join('');
  return `101${left}01010${right}101`;
}

/** A 640x480 clip of `frames` identical frames at 10 fps; returns the file path. */
export function writeBarcodeClip(code, { width = 640, height = 480, frames = 10, module = 5 } = {}) {
  const bits = ean13Modules(code);
  const barsW = bits.length * module;
  const x0 = Math.floor((width - barsW) / 2);
  const y0 = Math.floor(height / 2 - 110);
  const luma = Buffer.alloc(width * height, 235); // white
  for (let y = y0; y < y0 + 220; y++) {
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      luma.fill(16, y * width + x0 + i * module, y * width + x0 + (i + 1) * module); // black
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`);
  const file = join(mkdtempSync(join(tmpdir(), 'pb-barcode-')), 'barcode.y4m');
  writeFileSync(file, Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]));
  return file;
}
