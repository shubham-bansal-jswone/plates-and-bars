// The web build of the scanner view. Metro tries the extensions in order and only then the platform suffix, so this is `.ts`
// like index.ts (an `index.web.tsx` would lose to `index.ts` and the web build would ask for the native view). The browser decoder and the camera
// loop are in src/barcode (the zxing-wasm code is a separate chunk, loaded only when the scanner opens).
export type { BarcodeEvent, BarcodeFormat, ErrorEvent, ReadyEvent, ScannerViewProps } from './types';
export { WebScannerView as BarcodeScannerView } from '../../src/barcode/WebScannerView';
