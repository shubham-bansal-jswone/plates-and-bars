/**
 * Label OCR (#1067, ADR 010): the same call on Android (Tesseract4Android) and on the web (tesseract.js). An image goes in, text lines with a
 * confidence come out. Nothing here is a screen: the label flow and the parser sit on top of it.
 */

/** A box in pixels of the image that was read: the crop if there was one, upright (the phone's rotation is already applied). */
export type OcrBox = { x: number; y: number; width: number; height: number };

/** `confidence` is Tesseract's own scale, 0 to 100 (higher is surer). */
export type OcrWord = { text: string; confidence: number; box?: OcrBox };

/** `confidence` is the mean of the line's words. `words` and `box` are there for the parser to find the columns of a table. */
export type OcrLine = { text: string; confidence: number; words?: OcrWord[]; box?: OcrBox };

/** What to read, as fractions (0 to 1) of the upright image: x and y are the top-left corner. Omit it to read the whole image. */
export type OcrCrop = { x: number; y: number; width: number; height: number };

/** `ms` is the whole call, engine start included. */
export type OcrResult = { lines: OcrLine[]; ms: number };

/**
 * Why a scan failed. The label flow maps each to a way out (try again, or type the values; see ADR 010).
 * - disabled: the build has EXPO_PUBLIC_LABEL_SCAN off, so nothing was loaded
 * - unsupported: no OCR engine on this platform (iOS) or the native module is missing from the build
 * - image: the image could not be opened or decoded
 * - crop: the crop box is empty, outside the image or too small
 * - memory: the phone ran out of memory (a very large photo on a small phone)
 * - engine: the engine did not start (on the web: the worker, core or language data did not load)
 * - data: the bundled language data failed its checksum
 * - failed: anything else
 */
export type OcrErrorCode = 'disabled' | 'unsupported' | 'image' | 'crop' | 'memory' | 'engine' | 'data' | 'failed';
