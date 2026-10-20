// The web build of label OCR. Metro tries the extensions in order and only then the platform suffix, so this is `.ts` like index.ts.
// The engine (tesseract.js, its worker, core and language data) is in src/labelscan and loads only when `recognize` is called.
export type { OcrBox, OcrCrop, OcrErrorCode, OcrLine, OcrResult, OcrWord } from './types';
export { OcrError } from './errors';
export { recognize } from '../../src/labelscan/webRecognize';
