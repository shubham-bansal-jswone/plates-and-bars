/**
 * Label scanning (v2, ADR 010) is off until the owner's bake-off passes. Build-time flag: EXPO_PUBLIC_LABEL_SCAN=1; only exactly `1`
 * turns it on. While it is off `recognize` refuses before it loads anything: no native call, no web chunk, no model bytes.
 */
export function labelScanEnabled(raw: string | undefined = process.env.EXPO_PUBLIC_LABEL_SCAN): boolean {
  return raw === '1';
}
