/**
 * Calendar helpers on `YYYY-MM-DD` strings. The prototype builds local-time `Date`s; these use UTC
 * so the result does not depend on the device's time zone. For whole calendar days the two agree
 * (the prototype rounds away DST hours in `daysBetween`).
 */

/** Mirrors prototype `parseYmd(s)` (UTC instead of local time). */
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Mirrors prototype `ymd(d)`. */
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Day of the week, 0 = Sunday … 6 = Saturday. Mirrors prototype `parseYmd(date).getDay()`. */
export function weekdayOf(date: string): number {
  return parseYmd(date).getUTCDay();
}

/** Monday of the week containing `date`. Mirrors prototype `mondayOf(d)`. */
export function mondayOf(date: string): string {
  const x = parseYmd(date);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return ymd(x);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). Mirrors prototype `daysBetween(a, b)`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 864e5);
}
