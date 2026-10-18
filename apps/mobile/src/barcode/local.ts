import { sameBarcode } from '@plate-and-bar/core';
import type { UserFood } from '../food/types';


/** The saved user food for a scanned code, or undefined. Local only: a repeat scan never needs the network. */
export function findSaved(mine: readonly UserFood[], code: string): UserFood | undefined {
  return mine.find((f) => !f.deleted_at && sameBarcode(f.barcode, code));
}
