/**
 * Lenient number parse: accepts a comma as decimal separator and returns 0 for
 * anything that is not a finite number (null, undefined, '', NaN, Infinity).
 *
 * Mirrors prototype `num` (plate-and-bar.html).
 */
export function num(v: unknown): number {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
