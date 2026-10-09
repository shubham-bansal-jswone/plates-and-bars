import { bundle, contentGeneration } from './loader';

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
export const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
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
 * A lazy, memoised reader for one content bundle. `shipped` is the build-time JSON import (the synchronous baseline);
 * `read` turns a bundle object into what the screens use. The copy chosen at app start (`bundle()`) is used only when
 * `valid` accepts its shape; otherwise the shipped import is used. Never throws. Nothing is built at import time.
 */
export function contentReader<Raw, T>(name: string, shipped: Raw, valid: (v: unknown) => v is Raw, read: (raw: Raw) => T): () => T {
  return perLoad(() => {
    const chosen = bundle<unknown>(name, shipped);
    let raw: Raw = shipped;
    try {
      if (valid(chosen)) raw = chosen;
    } catch {
      // a validator must not throw; if it does the shipped copy is used
    }
    return read(raw);
  });
}
