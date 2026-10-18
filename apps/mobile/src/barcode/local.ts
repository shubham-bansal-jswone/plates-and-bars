import type { UserFood } from '../food/types';

/** A 12-digit UPC-A and the 13-digit EAN-13 with a leading 0 are the same product: compare them as one. */
const key = (code: string): string => (code.length === 12 ? `0${code}` : code);

/** The saved user food for a scanned code, or undefined. Local only: a repeat scan never needs the network. */
export function findSaved(mine: readonly UserFood[], code: string): UserFood | undefined {
  return mine.find((f) => !f.deleted_at && typeof f.barcode === 'string' && key(f.barcode) === key(code));
}
