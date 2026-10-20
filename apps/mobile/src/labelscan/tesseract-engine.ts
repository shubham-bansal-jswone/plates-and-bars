// The web OCR engine (#1067, ADR 010): tesseract.js 7 (Apache-2.0) running Tesseract 5 in a Web Worker, with the English LSTM data. Loaded by
// `import()` only when a label is scanned (the name `tesseract-` keeps the service worker from precaching it). Every file it needs is ours,
// under /tesseract/, so no request leaves our origin and the Content-Security-Policy needs no new source.
import { createWorker } from 'tesseract.js';
import type { OcrBox, OcrLine, OcrWord } from '../../modules/plate-label-scanner/types';
import { CORE_PATH, LANG_PATH, WORKER_PATH } from './webAssets';

export interface Engine {
  /** Reads one image (a PNG or JPEG blob made from the cropped canvas). */
  recognize(image: Blob): Promise<OcrLine[]>;
  /** Stops the worker and frees the core and the language data. */
  terminate(): Promise<void>;
}

type Bbox = { x0: number; y0: number; x1: number; y1: number };
const box = (b: Bbox): OcrBox => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });

const LSTM_ONLY = 1; // tesseract.js OEM.LSTM_ONLY; the language data is LSTM only

export async function createEngine(): Promise<Engine> {
  const worker = await createWorker('eng', LSTM_ONLY, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    // Start the worker from its own file, not from a blob: address (the CSP allows both, but a file is what the hash and the licence list describe).
    workerBlobURL: false,
    // The data is one plain file; `none` also keeps tesseract.js from storing it in IndexedDB (the browser's HTTP cache serves a repeat scan).
    gzip: false,
    cacheMethod: 'none',
  });
  return {
    async recognize(image) {
      const { data } = await worker.recognize(image, {}, { blocks: true });
      const lines: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const words: OcrWord[] = line.words
              .filter((w) => w.text.trim() !== '')
              .map((w) => ({ text: w.text.trim(), confidence: w.confidence, box: box(w.bbox) }));
            if (words.length === 0) continue;
            lines.push({ text: words.map((w) => w.text).join(' '), confidence: words.reduce((s, w) => s + w.confidence, 0) / words.length, words, box: box(line.bbox) });
          }
        }
      }
      return lines;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
