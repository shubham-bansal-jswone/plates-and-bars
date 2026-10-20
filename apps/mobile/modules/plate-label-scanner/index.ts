import { requireNativeModule } from 'expo';
import { labelScanEnabled } from '../../src/labelscan/flag';
import { toResult } from '../../src/labelscan/result';
import { OcrError, mapOcrError } from './errors';
import type { OcrCrop, OcrResult } from './types';

export type { OcrBox, OcrCrop, OcrErrorCode, OcrLine, OcrResult, OcrWord } from './types';
export { OcrError } from './errors';

type Native = {
  recognize(imageUri: string, crop: OcrCrop | null): Promise<unknown>;
  verifyData(): Promise<{ sha256: string; bytes: number }>;
};

let native: Native | null = null;
// Looked up on first use, so other platforms, tests and a build with the flag off never load it.
const nativeModule = (): Native => (native ??= requireNativeModule<Native>('PlateLabelScanner'));

/**
 * Reads the text in an image on this phone (Tesseract 5 in the native module, off the UI thread). `imageUri` is the content: or file: address
 * the camera or the system photo picker gave; `crop` is a box as fractions of the upright image. The image is decoded in memory and dropped:
 * nothing is written to disk, logged or sent, and no network request is made. Throws an [OcrError] (`disabled` when the flag is off).
 */
export async function recognize(imageUri: string, crop?: OcrCrop): Promise<OcrResult> {
  if (!labelScanEnabled()) throw new OcrError('disabled');
  try {
    return toResult(await nativeModule().recognize(imageUri, crop ?? null));
  } catch (e) {
    throw mapOcrError(e);
  }
}

/** Copies the bundled language data to private storage if needed and returns the sha256 of the file the engine will read. */
export async function verifyData(): Promise<{ sha256: string; bytes: number }> {
  if (!labelScanEnabled()) throw new OcrError('disabled');
  try {
    return await nativeModule().verifyData();
  } catch (e) {
    throw mapOcrError(e);
  }
}
