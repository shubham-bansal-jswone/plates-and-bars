// Where the web OCR engine's files are, all on our own origin (public/tesseract/). Nothing is ever fetched from a CDN: tesseract.js
// defaults to jsDelivr for each of these three, so each is given explicitly. The folders carry the version, so a tab still running an
// older chunk never loads a newer file whose interface it does not know.

/** The tesseract.js version, and the tesseract.js-core version it was built against. package.json pins both; a jest test checks. */
export const TESSERACT_JS_VERSION = '7.0.0';
export const TESSERACT_CORE_VERSION = '7.0.0';
/** tessdata_fast tag of the language data. */
export const TESSDATA_VERSION = '4.1.0';

export const WORKER_PATH = `/tesseract/js-${TESSERACT_JS_VERSION}/worker.min.js`;
/** A folder: tesseract.js picks tesseract-core[-simd|-relaxedsimd]-lstm.wasm.js in it by what the browser supports. */
export const CORE_PATH = `/tesseract/core-${TESSERACT_CORE_VERSION}/`;
/** A folder holding eng.traineddata. */
export const LANG_PATH = `/tesseract/tessdata-fast-${TESSDATA_VERSION}/`;
/** The pinned sha256 of eng.traineddata; the same file is the Android asset (TessData.kt). A jest test checks the served file. */
export const TRAINEDDATA_SHA256 = '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';

/** The long side of the image given to the engine, as on Android. */
export const MAX_EDGE = 2400;
