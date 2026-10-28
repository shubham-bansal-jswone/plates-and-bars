import { EXERCISE_OVERRIDES_MAX } from '@plate-and-bar/core';
import { withEntry } from '../content/own';
import type { Settings } from '../settings/types';

/** The "Smallest weight jump" choices an lb user picks from, in lb (core's `LB_STEP` values 2.5 and 5, and 10). Stored as the exact kg equivalent. */
export const LB_JUMP_CHOICES: readonly number[] = Object.freeze([2.5, 5, 10]);

/** One entry of contract `Settings.exercise_overrides`. */
export type Overrides = Settings['exercise_overrides'];

export const RANGE_INVALID = 'Set a valid range, like 8 to 12.';
export const STEP_INVALID = 'Pick a valid weight jump.';
export const OVERRIDES_FULL = `You have set up the most exercises that can be changed (${EXERCISE_OVERRIDES_MAX}). Reset one to default first.`;

/** The overrides with `name` set to `entry`, in a new object. `defineProperty` adds an own entry also for a name like `__proto__` (an assignment would set the prototype; the compiled object literal does too). */
export function withOverride(all: Overrides, name: string, entry: Overrides[string]): Overrides {
  return withEntry(all, name, entry);
}

/** The overrides without `name`'s entry ("Reset to default"). */
export function withoutOverride(all: Overrides, name: string): Overrides {
  return Object.fromEntries(Object.entries(all).filter(([k]) => k !== name));
}
