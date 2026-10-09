import { bundle, contentGeneration } from './loader';

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
export const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
/** A string of 1 to `max` characters. */
export const isText = (max: number) => (v: unknown): v is string => isStr(v) && v.length >= 1 && v.length <= max;
/** A finite number within [min, max]. */
export const isNumIn = (min: number, max: number) => (v: unknown): v is number => isNum(v) && v >= min && v <= max;
export const isUuid = (v: unknown): v is string => isStr(v) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isArrOf = <T>(v: unknown, ok: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(ok);

/** Computes on first call after each `loadContent` and returns the same value until the next one. */
export function perLoad<T>(compute: () => T): () => T {
  let at = -1;
  let value: T;
  return () => {
    if (at !== contentGeneration()) {
      value = compute();
      at = contentGeneration();
    }
    return value;
  };
}

/**
 * The one accept or reject decision for a bundle: the copy chosen at app start (`bundle()`) when `valid` accepts the
 * WHOLE bundle, else the shipped import. Every reader of that bundle must call this same getter (or one built on it), so a
 * stored copy is wholly used or wholly rejected and two screens never disagree. Memoised until the next `loadContent`
 * (the validator runs once per launch). Never throws: a validator that throws counts as a rejection.
 */
export function contentReader<Raw>(name: string, shipped: Raw, valid: (v: unknown) => v is Raw): () => Raw {
  return perLoad(() => {
    const chosen = bundle<unknown>(name, shipped);
    try {
      if (valid(chosen)) return chosen;
    } catch {
      // rejected
    }
    return shipped;
  });
}
