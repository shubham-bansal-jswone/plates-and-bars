import { addDays } from './dates';

/**
 * Bounding `adj.dismissed` (contract `Settings.adjustments.dismissed`), #721. The prototype only ever adds
 * to it (`A.dismissed[key] = true` in `adjAction`, `exAction` and `checkinAction`), one key per answered
 * card, so it would grow past the contract's 64 KB `x-max-json-bytes` on `adjustments`. Every card key
 * ends in a date (`kcal:`, `ci:`, `deload:`, `dlplan:` + a Monday; `missed:` + the day shown; `break:` +
 * the last session; `stall:`, `up:`, `down:` + `<name>:` + the lift's last record), and the cards look a
 * key up only by exact match, so a key can be judged by that date.
 */

/** Keys dated more than this many days before today are dropped (unless the newest of their group). */
export const DISMISSED_MAX_AGE_DAYS = 90;
/** At most this many keys are kept. */
export const DISMISSED_MAX_KEYS = 300;
/** At most this many UTF-8 bytes of compact JSON (half the 64 KB cap on `adjustments`, which holds more than `dismissed`). */
export const DISMISSED_MAX_BYTES = 32768;

const DATED = /^(.*):(\d{4}-\d{2}-\d{2})$/;

/** An upper bound on the UTF-8 bytes of `s` written by `JSON.stringify` (a surrogate pair counts 6, not 4). */
function jsonBytes(s: string): number {
  const j = JSON.stringify(s);
  let n = 0;
  for (let i = 0; i < j.length; i++) {
    const c = j.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return n;
}

/**
 * `dismissed` without keys that can no longer hide a card. Falsy entries go (they hide nothing). A key whose
 * trailing date is more than `DISMISSED_MAX_AGE_DAYS` (90) days before `today` goes, unless it is the newest
 * key of its group (the key without its date, e.g. `break` or `stall:<name>`): a `break:`, `stall:`, `up:`
 * or `down:` key carries the date of the last session or lift record, which can be any age while the user is
 * away, so the newest one may still be the one the card shows. Keys without a date are kept. Then at most
 * `DISMISSED_MAX_KEYS` (300) keys and `DISMISSED_MAX_BYTES` (32 KB) are kept: `keep` first, then the newest
 * key of each group, then the other keys by newest date, keys without a date last. Kept keys stay in their
 * order. `today` is the real date, `YYYY-MM-DD`.
 *
 * Not in the prototype, which never prunes (#721).
 */
export function pruneDismissed(dismissed: Readonly<Record<string, unknown>> | null | undefined, today: string, keep?: string): Record<string, boolean> {
  const cutoff = addDays(today, -DISMISSED_MAX_AGE_DAYS);
  const keys = Object.keys(dismissed || {}).filter((k) => (dismissed as Record<string, unknown>)[k]);
  const dateOf = new Map<string, string>();
  const groupOf = new Map<string, string>();
  const newest = new Map<string, string>();
  for (const k of keys) {
    const m = DATED.exec(k);
    if (!m) continue;
    const group = m[1] as string, date = m[2] as string;
    dateOf.set(k, date);
    groupOf.set(k, group);
    if (date > (newest.get(group) ?? '')) newest.set(group, date);
  }
  const live = keys.filter((k) => {
    const date = dateOf.get(k);
    return k === keep || date === undefined || date >= cutoff || newest.get(groupOf.get(k) as string) === date;
  });
  const order = new Map(live.map((k, i) => [k, i]));
  const head = (k: string): boolean => dateOf.has(k) && newest.get(groupOf.get(k) as string) === dateOf.get(k);
  const ranked = [...live].sort((a, b) => {
    if (a === keep || b === keep) return a === keep ? -1 : 1;
    if (head(a) !== head(b)) return head(a) ? -1 : 1;
    const da = dateOf.get(a) ?? '', db = dateOf.get(b) ?? '';
    if (da !== db) return da < db ? 1 : -1;
    return (order.get(b) as number) - (order.get(a) as number);
  });
  const kept = new Set<string>();
  let bytes = 2; // {}
  for (const k of ranked) {
    const add = jsonBytes(k) + 5 + (kept.size ? 1 : 0); // "key":true, comma between entries
    if (kept.size >= DISMISSED_MAX_KEYS || bytes + add > DISMISSED_MAX_BYTES) break;
    kept.add(k);
    bytes += add;
  }
  const out: Record<string, boolean> = {};
  for (const k of live) if (kept.has(k)) out[k] = true;
  return out;
}

/**
 * Answering a card: `key` dismissed, then the map pruned (`pruneDismissed`, keeping `key`). Use it wherever
 * the prototype sets `A.dismissed[key] = true`.
 *
 * Mirrors the `A.dismissed[key] = true` step of prototype `adjAction`, `exAction` and `checkinAction`, plus
 * `pruneDismissed` (#721).
 */
export function dismissKey(dismissed: Readonly<Record<string, unknown>> | null | undefined, key: string, today: string): Record<string, boolean> {
  return pruneDismissed({ ...(dismissed || {}), [key]: true }, today, key);
}
