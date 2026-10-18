import type { BarcodeFormat } from '../../modules/plate-barcode-scanner/types';

/** EAN and UPC only (#944): what groceries carry. No QR, so a URL in a QR code is never read. */
export const WEB_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;
type WebFormat = (typeof WEB_FORMATS)[number];

const TO_APP: Record<WebFormat, BarcodeFormat> = { ean_13: 'EAN_13', ean_8: 'EAN_8', upc_a: 'UPC_A', upc_e: 'UPC_E' };
const isWebFormat = (f: unknown): f is WebFormat => typeof f === 'string' && (WEB_FORMATS as readonly string[]).includes(f);

export interface Reading {
  code: string;
  format: BarcodeFormat;
}

/** Reads one frame: the first EAN or UPC code in it, or null. */
export interface FrameDecoder {
  /** Which engine is behind it: the browser's own `BarcodeDetector`, or the self-hosted zxing-wasm ponyfill. */
  kind: 'native' | 'zxing';
  read(frame: HTMLVideoElement): Promise<Reading | null>;
}

/** The part of the Barcode Detection API this app uses (the browser's class and the ponyfill have the same shape). */
export interface DetectorClass {
  new (options: { formats: string[] }): { detect(source: HTMLVideoElement): Promise<{ rawValue: string; format: string }[]> };
  getSupportedFormats?: () => Promise<string[]>;
}

export interface DecoderDeps {
  /** The browser's `BarcodeDetector`, when it has one. */
  native: DetectorClass | undefined;
  /** Loads the ponyfill chunk (and with it, on first use, the self-hosted .wasm). */
  loadPonyfill: () => Promise<DetectorClass>;
}

function wrap(kind: FrameDecoder['kind'], detector: InstanceType<DetectorClass>): FrameDecoder {
  return {
    kind,
    async read(frame) {
      try {
        const hit = (await detector.detect(frame)).find((r) => isWebFormat(r.format) && typeof r.rawValue === 'string' && r.rawValue !== '');
        return hit ? { code: hit.rawValue, format: TO_APP[hit.format as WebFormat] } : null;
      } catch {
        return null; // a frame the engine could not take (video not ready, a decode error): the next frame is tried
      }
    },
  };
}

/**
 * The native `BarcodeDetector` when it lists `ean_13` (Chrome on Android, Chrome on macOS), else the MIT barcode-detector
 * ponyfill over zxing-wasm, whose .wasm is on our own origin. The ponyfill is only loaded when the native one will not do.
 */
export async function createFrameDecoder(deps: DecoderDeps): Promise<FrameDecoder> {
  const Native = deps.native;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? [];
      if (supported.includes('ean_13')) return wrap('native', new Native({ formats: WEB_FORMATS.filter((f) => supported.includes(f)) }));
    } catch {
      // a browser whose detector throws is treated as having none
    }
  }
  const Ponyfill = await deps.loadPonyfill();
  return wrap('zxing', new Ponyfill({ formats: [...WEB_FORMATS] }));
}
