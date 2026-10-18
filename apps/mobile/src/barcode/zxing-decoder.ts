// The ponyfill for browsers whose own BarcodeDetector cannot read EAN-13 (#944): barcode-detector (MIT) over zxing-wasm (MIT, wrapping
// ZXing-C++, Apache-2.0). Loaded by `import()` only when the scanner opens on such a browser (the name `zxing-` keeps the service worker
// from precaching it). The library's default fetches its .wasm from a public CDN; that address is never used: the file is ours,
// at /zxing/3.1.3/ (public/zxing/3.1.3/), so no request leaves our origin and the Content-Security-Policy needs no new source.
import { BarcodeDetector, setZXingModuleOverrides } from 'barcode-detector/ponyfill';

// Versioned: the glue is in a content-hashed chunk, so a tab running an old chunk must never fetch a newer wasm (the imports would not match).
export const WASM_PATH = '/zxing/3.1.3/';

setZXingModuleOverrides({
  // Only the reader build is ever asked for; anything else gets the default prefix (this app's own origin), never a CDN.
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `${WASM_PATH}${path}` : `${prefix}${path}`),
});

export { BarcodeDetector };
