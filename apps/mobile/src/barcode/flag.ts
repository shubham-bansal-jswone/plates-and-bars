/**
 * The barcode scanner is a v1.1 feature that is off until the app wiring lands (#944). Build-time flag: EXPO_PUBLIC_BARCODE_SCAN=1.
 * While it is off the only way in is the dev screen (app/barcode-dev.tsx), which sends you home when the flag is off.
 */
export function barcodeScanEnabled(raw: string | undefined = process.env.EXPO_PUBLIC_BARCODE_SCAN): boolean {
  return raw === '1';
}
