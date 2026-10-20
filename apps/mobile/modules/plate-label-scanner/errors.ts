import type { OcrErrorCode } from './types';

const TEXT: Record<OcrErrorCode, string> = {
  disabled: 'Label scanning is off in this build.',
  unsupported: 'Label scanning is not available on this device.',
  image: 'The image could not be read.',
  crop: 'The crop box is not valid.',
  memory: 'Not enough memory to read this image.',
  engine: 'The text reader did not start.',
  data: 'The text reader data failed its check.',
  failed: 'The label could not be read.',
};

/**
 * Every failure of `recognize` is one of these. The message is fixed text for the code: it never carries the image address, the
 * recognised text or the engine's own message, so a crash or error report cannot leak either (ADR 010).
 */
export class OcrError extends Error {
  readonly code: OcrErrorCode;
  constructor(code: OcrErrorCode) {
    super(TEXT[code]);
    this.name = 'OcrError';
    this.code = code;
  }
}

const NATIVE_CODES: Record<string, OcrErrorCode> = {
  ERR_OCR_IMAGE: 'image',
  ERR_OCR_CROP: 'crop',
  ERR_OCR_MEMORY: 'memory',
  ERR_OCR_ENGINE: 'engine',
  ERR_OCR_NO_CONTEXT: 'engine',
  ERR_OCR_DATA_HASH: 'data',
};

/** Maps what the native module (a coded error from Expo) or the web engine threw to an [OcrError]. An OcrError passes through unchanged. */
export function mapOcrError(e: unknown): OcrError {
  if (e instanceof OcrError) return e;
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && code in NATIVE_CODES) return new OcrError(NATIVE_CODES[code]!);
  const message = e instanceof Error ? e.message : '';
  if (/cannot find native module|ERR_MODULE_NOT_FOUND/i.test(message)) return new OcrError('unsupported');
  if (e instanceof Error && e.name === 'OutOfMemory') return new OcrError('memory');
  return new OcrError('failed');
}
