/** Own-property helpers: content keys come from stored server copies, so a key such as `constructor` must never read an inherited member. */
export const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** `map[k]` when `k` is an own key, else `k` itself (the raw-key fallback for a key without a label). */
export const ownOr = (map: Readonly<Record<string, string>>, k: string): string => (has(map, k) ? (map[k] as string) : k);

/** True for `__proto__` and every `Object.prototype` member name (`toString`, `constructor`, `hasOwnProperty`, ...): not allowed as a content key. */
export const isProtoName = (k: string): boolean => k in Object.prototype;
