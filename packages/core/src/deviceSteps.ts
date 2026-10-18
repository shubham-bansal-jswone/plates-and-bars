/**
 * Device step count from a since-boot counter (#300). Android's TYPE_STEP_COUNTER only gives a running total since the phone
 * booted; this turns readings of it into per-day step counts without a background task (the app reads it when it opens, comes
 * to the foreground and at midnight). There is no prototype counterpart (the prototype has no step sensor), so no golden file.
 *
 * Rules, all conservative (an undercount is accepted, an overcount is not):
 * - The day being counted starts at 0 when counting starts; steps from before are unknown.
 * - Steps between two readings of the same day belong to that day.
 * - A gap that crosses midnight cannot be split without a background task. It is never added to the new day; it is credited to
 *   the previous day only when exactly one midnight passed, and dropped when more passed or the phone rebooted in between.
 * - After a reboot the counter restarted at 0, so the delta is the new counter value (steps before the reboot are lost).
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
  baseline: StepBaseline;
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

/**
 * Applies a reading taken on local day `today` to the stored baseline (null when counting has not started).
 * Returns the new baseline and the day totals to write.
 */
export function advanceSteps(base: StepBaseline | null, now: StepReading, today: string): StepAdvance {
  const fresh = (steps: number): StepBaseline => ({ date: today, steps, counter: now.counter, elapsedMs: now.elapsedMs });
  // First reading, or the clock moved back before the counted day: start today at 0.
  if (!base || today < base.date) return { baseline: fresh(0), credits: [] };

  const reboot = isReboot(base, now);
  const delta = whole(reboot ? now.counter : now.counter - base.counter);

  if (today === base.date) {
    const steps = base.steps + delta;
    return { baseline: fresh(steps), credits: delta > 0 ? [{ date: today, steps }] : [] };
  }

  // Midnight passed since the last reading: today starts at 0 and the gap goes to the previous day only when it is unambiguous.
  const credit = !reboot && delta > 0 && addDays(base.date, 1) === today;
  return { baseline: fresh(0), credits: credit ? [{ date: base.date, steps: base.steps + delta }] : [] };
}
