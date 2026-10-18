/**
 * Device step count from a since-boot counter (#300). Android's TYPE_STEP_COUNTER only gives a running total since the phone
 * booted; this turns readings of it into per-day step counts without a background task (the app reads it when it opens, comes
 * to the foreground and at midnight). There is no prototype counterpart (the prototype has no step sensor), so no golden file.
 *
 * Rules, all conservative (an undercount is accepted, an overcount is not):
 * - The day being counted starts at 0 when counting starts; steps from before are unknown.
 * - Steps between two readings of the same day belong to that day.
 * - A gap that crosses midnight cannot be split without a background task. It is never added to the new day. It is credited to the
 *   previous day only when exactly one midnight passed, the phone did not reboot, and the reading came within `MIDNIGHT_WINDOW_MS`
 *   after that midnight (so the gap holds at most a few minutes of the new day, as when the running app notices the day change);
 *   otherwise it is dropped. A reading at 18:00 the next day is therefore dropped, never credited to the day before.
 * - After a reboot the counter restarted at 0, so the delta is the new counter value (steps before the reboot are lost).
 * - A reading that is not a finite, non-negative pair is ignored: the baseline is left as it was.
 */
import { addDays } from './dates';

/** One reading of the sensor: the since-boot counter and `SystemClock.elapsedRealtime()` in ms (monotonic within one boot). */
export interface StepReading {
  counter: number;
  elapsedMs: number;
}

/** What is kept between readings: the day being counted, its steps so far, and the last reading. */
export interface StepBaseline extends StepReading {
  /** Local `YYYY-MM-DD` the steps belong to. */
  date: string;
  steps: number;
}

/** A day's device step total after a reading (the whole day's count, not the increase). */
export interface StepCredit {
  date: string;
  steps: number;
}

export interface StepAdvance {
  /** The baseline to keep; the one passed in (null if none) when the reading was not valid. */
  baseline: StepBaseline | null;
  /** Day totals that changed, oldest first; empty when nothing was gained. */
  credits: StepCredit[];
}

/**
 * True when the phone restarted since `base`: uptime went backwards (it cannot within one boot, whatever the clock does) or the
 * counter went down. A restart this misses (both above the old values) leaves a delta that is too low, never too high.
 */
export function isReboot(base: StepReading, now: StepReading): boolean {
  return now.elapsedMs < base.elapsedMs || now.counter < base.counter;
}

/** Whole steps, never negative or non-finite (the sensor reports a float). */
const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** How soon after local midnight a reading may come and still credit the gap to the day before (the app's own day-change check runs every minute). */
export const MIDNIGHT_WINDOW_MS = 5 * 60_000;

const valid = (n: number): boolean => Number.isFinite(n) && n >= 0;

/**
 * Applies a reading taken on local day `today`, `msSinceMidnight` ms after that day's local midnight (real elapsed time, so a DST
 * day is right), to the stored baseline (null when counting has not started). Returns the new baseline and the day totals to write.
 */
export function advanceSteps(base: StepBaseline | null, now: StepReading, today: string, msSinceMidnight: number): StepAdvance {
  if (!valid(now.counter) || !valid(now.elapsedMs)) return { baseline: base, credits: [] };
  const fresh = (steps: number): StepBaseline => ({ date: today, steps, counter: now.counter, elapsedMs: now.elapsedMs });
  // First reading: start today at 0.
  if (!base) return { baseline: fresh(0), credits: [] };

  const reboot = isReboot(base, now);
  const delta = whole(reboot ? now.counter : now.counter - base.counter);

  if (today === base.date) {
    const steps = base.steps + delta;
    return { baseline: fresh(steps), credits: delta > 0 ? [{ date: today, steps }] : [] };
  }

  // Any other day (a midnight passed, or the clock went back or the time zone moved west: nothing is credited then): today starts at 0.
  const soon = Number.isFinite(msSinceMidnight) && msSinceMidnight >= 0 && msSinceMidnight <= MIDNIGHT_WINDOW_MS;
  const credit = !reboot && delta > 0 && soon && addDays(base.date, 1) === today;
  return { baseline: fresh(0), credits: credit ? [{ date: base.date, steps: base.steps + delta }] : [] };
}
