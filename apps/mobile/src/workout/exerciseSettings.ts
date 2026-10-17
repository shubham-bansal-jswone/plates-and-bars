import { num, type ExType } from '@plate-and-bar/core';
import type { Settings } from '../settings/types';
import { isBlank } from '../text/blank';

/** One entry of contract `Settings.exercise_overrides`. */
export type Override = Settings['exercise_overrides'][string];

/** The equipment chips, in the prototype's order (`other` is only for exercises the app does not know). */
export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight', 'time'] as const satisfies readonly ExType[];

/** The "Smallest weight jump" chips, in kg (prototype `renderExSettings`). The default for a type is core's `DEFAULT_STEP`. */
export const STEP_CHOICES = [1, 1.25, 2, 2.5, 5, 10] as const;

export const RANGE_INVALID = 'Set a valid range, like 8 to 12.';

/**
 * The override to save from the sheet's values, or null when the range is not valid. The range is read as the prototype reads
 * it (`Math.round(num(text))`, a blank or unreadable field is 0) and must fit the contract: whole reps of at least 1
 * (`rep_low`, `rep_high`), low not above high. `step_kg` is a chip or core's default for the type, never below the contract's 0.
 */
export function overrideFromDraft(d: { type: ExType; step: number; lo: string; hi: string }): Override | null {
  const lo = isBlank(d.lo) ? 0 : Math.round(num(d.lo));
  const hi = isBlank(d.hi) ? 0 : Math.round(num(d.hi));
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo < 1 || hi < lo) return null;
  return { type: d.type, step_kg: Math.max(0, d.step), rep_low: lo, rep_high: hi };
}

/** The overrides without `name`'s entry ("Reset to default"). */
export function withoutOverride(all: Settings['exercise_overrides'], name: string): Settings['exercise_overrides'] {
  return Object.fromEntries(Object.entries(all).filter(([k]) => k !== name));
}
