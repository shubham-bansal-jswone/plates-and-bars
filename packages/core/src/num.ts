/**
 * Lenient number parse: accepts a comma as decimal separator and returns 0 for
 * anything that is not a finite number (null, undefined, '', NaN, Infinity).
 *
 * Mirrors prototype `num` (prototype-final tag).
 */
export function num(v: unknown): number {
  return parseNum(v) ?? 0;
}

/**
 * The value `num` reads, or null when it is not a finite number (null, undefined, '', junk). Tells a
 * typed 0 from nothing typed; `num` is built on it so the two always agree. New helper, no prototype function.
 */
export function parseNum(v: unknown): number | null {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
