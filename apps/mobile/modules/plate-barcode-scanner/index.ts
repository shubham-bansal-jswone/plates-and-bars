import { createElement, type ComponentType, type ReactElement } from 'react';
import type { ScannerViewProps } from './types';
import { requireNativeView } from 'expo';

export type { BarcodeEvent, BarcodeFormat, ErrorEvent, ReadyEvent, ScannerViewProps } from './types';

let view: ComponentType<ScannerViewProps> | null = null;

/** The native camera view (CameraX plus zxing-cpp). Android only; the native view is looked up on first render so other platforms and tests never load it. */
export function BarcodeScannerView(props: ScannerViewProps): ReactElement {
  view ??= requireNativeView<ScannerViewProps>('PlateBarcodeScanner');
  return createElement(view, props);
}
