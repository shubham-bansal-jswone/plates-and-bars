import type { OcrCrop, OcrResult } from '../../modules/plate-label-scanner/types';
import { OcrError, mapOcrError } from '../../modules/plate-label-scanner/errors';
import { cropRect } from './crop';
import { labelScanEnabled } from './flag';
import { toResult } from './result';
import { loadEngine } from './webLoad';
import { MAX_EDGE } from './webAssets';

/** Only what the picker or the camera gives the page: a blob: or data: image, or a file of our own origin. Never another site. */
function allowed(uri: string): boolean {
  if (/^blob:/i.test(uri) || /^data:image\//i.test(uri)) return true;
  try {
    return new URL(uri, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Decodes the image (the browser applies the photo's rotation) and draws the crop into a canvas of at most MAX_EDGE on its long side. */
async function cropToCanvas(uri: string, crop: OcrCrop | undefined): Promise<HTMLCanvasElement> {
  if (!allowed(uri)) throw new OcrError('image');
  const img = new Image();
  img.src = uri;
  try {
    await img.decode();
  } catch {
    throw new OcrError('image');
  }
  if (img.naturalWidth <= 0 || img.naturalHeight <= 0) throw new OcrError('image');
  const rect = cropRect(crop, img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, MAX_EDGE / Math.max(rect.width, rect.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new OcrError('memory');
  ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new OcrError('memory'))), 'image/png'));

/**
 * Reads the text in an image in this browser (tesseract.js in a worker). `imageUri` is a blob: or data: address from the picker or the
 * camera; `crop` is a box as fractions of the upright image. The engine loads on the first call, from our own origin, and is stopped
 * again when the call ends, so nothing stays in memory between scans. The image stays in memory: nothing is stored, logged or sent.
 * Throws an [OcrError] (`disabled` when the flag is off, before anything is loaded).
 */
export async function recognize(imageUri: string, crop?: OcrCrop): Promise<OcrResult> {
  if (!labelScanEnabled()) throw new OcrError('disabled');
  const started = Date.now();
  try {
    const canvas = await cropToCanvas(imageUri, crop); // fails fast on a bad image or crop, before the engine is fetched
    let image: Blob;
    try {
      image = await toBlob(canvas);
    } finally {
      canvas.width = 0; // drop the pixels
      canvas.height = 0;
    }
    const engine = await loadEngine().then((create) => create()).catch((e: unknown) => {
      throw e instanceof OcrError ? e : new OcrError('engine');
    });
    try {
      const lines = await engine.recognize(image);
      return toResult({ lines, ms: Date.now() - started });
    } finally {
      await engine.terminate().catch(() => undefined);
    }
  } catch (e) {
    throw mapOcrError(e);
  }
}
