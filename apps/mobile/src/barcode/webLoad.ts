import type { DecoderDeps, DetectorClass } from './webDecoder';

// The one place the zxing-wasm chunk is imported on demand (a separate web chunk named zxing-decoder, which the service worker
// does not precache), so the main bundle does not carry it and tests can stand in for it (jest cannot run `import()`).
const loadPonyfill = (): Promise<DetectorClass> => import('./zxing-decoder').then((m) => m.BarcodeDetector as unknown as DetectorClass);

/** The browser's own detector when it has one, and the way to load the ponyfill when it will not do. */
export const browserDecoderDeps = (): DecoderDeps => ({ native: (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector, loadPonyfill });
