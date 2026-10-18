import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

/** The four symbologies the reader accepts (#944): native on Android, and on the web the browser's BarcodeDetector or the zxing-wasm ponyfill. UPC-A is how an EAN-13 with a leading zero is reported. */
export type BarcodeFormat = 'EAN_13' | 'EAN_8' | 'UPC_A' | 'UPC_E';

export type BarcodeEvent = NativeSyntheticEvent<{ code: string; format: BarcodeFormat }>;
export type ReadyEvent = NativeSyntheticEvent<{ torch: boolean }>;
/** On the web `message` is `denied` when the user refused the camera (or the browser blocks it), else `camera` or `decoder`. */
export type ErrorEvent = NativeSyntheticEvent<{ message: string }>;

export type ScannerViewProps = {
  style?: StyleProp<ViewStyle>;
  /** Torch on or off; ignored on a phone with no flash. */
  torch?: boolean;
  /** false pauses reading (the preview keeps running); the view sets itself to read once after each hit until this goes false then true. */
  active?: boolean;
  onBarcode: (e: BarcodeEvent) => void;
  onReady?: (e: ReadyEvent) => void;
  onError?: (e: ErrorEvent) => void;
};
