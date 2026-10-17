/** Own-property helpers: content keys come from stored server copies, so a key such as `constructor` must never read an inherited member. */
export const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** `map[k]` when `k` is an own key, else `k` itself (the raw-key fallback for a key without a label). */
export const ownOr = (map: Readonly<Record<string, string>>, k: string): string => (has(map, k) ? (map[k] as string) : k);

/** True for `__proto__` and every `Object.prototype` member name (`toString`, `constructor`, `hasOwnProperty`, ...): not allowed as a content key. */
export const isProtoName = (k: string): boolean => k in Object.prototype;

/**
 * `all` with `k` set to `value`, in a new object. Not a spread: a computed `__proto__` key in an object literal sets the
 * prototype (and `{ ...all }` drops an own `__proto__` entry), so the copy is built with `fromEntries` and `defineProperty`,
 * which keep a user-named entry such as `__proto__` as data.
 */
export function withEntry<V>(all: Readonly<Record<string, V>>, k: string, value: V): Record<string, V> {
  const out: Record<string, V> = Object.fromEntries(Object.entries(all));
  Object.defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
  return out;
}

/** `all[k]` when `k` is an own key, else undefined (`all['__proto__']` would read the prototype). */
export const ownGet = <V,>(all: Readonly<Record<string, V>>, k: string): V | undefined => (has(all, k) ? all[k] : undefined);
