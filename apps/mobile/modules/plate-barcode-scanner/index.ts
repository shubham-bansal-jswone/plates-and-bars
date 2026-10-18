import { createElement, type ComponentType, type ReactElement } from 'react';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';
import { requireNativeView } from 'expo';

/** The four symbologies the native reader accepts (#944). UPC-A is how an EAN-13 with a leading zero is reported. */
export type BarcodeFormat = 'EAN_13' | 'EAN_8' | 'UPC_A' | 'UPC_E';

export type BarcodeEvent = NativeSyntheticEvent<{ code: string; format: BarcodeFormat }>;
export type ReadyEvent = NativeSyntheticEvent<{ torch: boolean }>;
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

let view: ComponentType<ScannerViewProps> | null = null;

/** The native camera view (CameraX plus zxing-cpp). Android only; the native view is looked up on first render so other platforms and tests never load it. */
export function BarcodeScannerView(props: ScannerViewProps): ReactElement {
  view ??= requireNativeView<ScannerViewProps>('PlateBarcodeScanner');
  return createElement(view, props);
}
