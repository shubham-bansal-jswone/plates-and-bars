import { addDays, daysBetween } from './dates';

/**
 * Cycle log rules (prototype `cycInfo`, `cycData`, and the `cyc-log` / `cyc-undo` / `cyc-off` actions). Device only: this data
 * is never synced, has no contract field and is never sent to the server or to AI. The app stores it in its own local table.
 */
export interface CycleData {
  on: boolean;
  /** Period start dates, `YYYY-MM-DD`. */
  starts: string[];
  /** Cycle length in days used until two usable gaps exist. */
  len: number;
}

export type CyclePhase = 'period' | 'follicular' | 'around ovulation' | 'luteal (before your period)';

export interface CycleInfo {
  /** Cycle day, 1 on the day the last period started. */
  day: number;
  /** Cycle length: the mean of the last (up to) 3 gaps of 18–45 days, else the stored length. */
  len: number;
  phase: CyclePhase;
  /** Start of the cycle the date is in. */
  last: string;
  /** More than a week past the expected length. */
  late: boolean;
}

/** Mirrors the empty value of prototype `cycData()` and of `cyc-off`. */
export const emptyCycle = (): CycleData => ({ on: false, starts: [], len: 28 });

/** Mirrors prototype `cycInfo(date)` with the stored data passed in; null when off, empty, or `date` is before every start. */
export function cycInfo(d: CycleData, date: string): CycleInfo | null {
  if (!d.on || !d.starts.length) return null;
  const starts = d.starts.filter((x) => x <= date).sort();
  const last = starts[starts.length - 1];
  if (last === undefined) return null;
  const all = d.starts.slice().sort();
  const gaps = all.map((x, i) => (i ? daysBetween(all[i - 1] as string, x) : null)).filter((x): x is number => !!x && x >= 18 && x <= 45);
  const len = gaps.length ? Math.round(gaps.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, gaps.length)) : d.len;
  const day = daysBetween(last, date) + 1;
  const phase: CyclePhase = day <= 5 ? 'period' : day < len - 16 ? 'follicular' : day <= len - 12 ? 'around ovulation' : 'luteal (before your period)';
  return { day, len, phase, last, late: day > len + 7 };
}

/** True in the period and luteal phases, where the prototype says water retention is common (`c.phase.startsWith('luteal') || c.phase === 'period'`). */
export const waterRetentionPhase = (c: CycleInfo): boolean => c.phase.startsWith('luteal') || c.phase === 'period';

/** The day in the previous cycle that matches `c`'s day, as the prototype's "Same day last cycle" line computes it. */
export const sameDayLastCycle = (c: CycleInfo): string => addDays(c.last, -c.len + c.day - 1);

/** Mirrors the `cyc-log` action: adds the start (once) and keeps the list sorted. Returns a new object. */
export function addCycleStart(d: CycleData, date: string): CycleData {
  const starts = d.starts.includes(date) ? d.starts.slice() : [...d.starts, date];
  return { ...d, starts: starts.sort() };
}

/** Mirrors the `cyc-undo` action: drops the latest start. Returns a new object. */
export function removeLastCycleStart(d: CycleData): CycleData {
  return { ...d, starts: d.starts.slice().sort().slice(0, -1) };
}
