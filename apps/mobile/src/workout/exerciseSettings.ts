import type { Settings } from '../settings/types';

/** One entry of contract `Settings.exercise_overrides`. */
export type Overrides = Settings['exercise_overrides'];

export const RANGE_INVALID = 'Set a valid range, like 8 to 12.';
export const STEP_INVALID = 'Pick a valid weight jump.';
export const OVERRIDES_FULL = 'You have set up the most exercises that can be changed (500). Reset one to default first.';

/** The overrides with `name` set to `entry`, in a new object. `defineProperty` adds an own entry also for a name like `__proto__` (an assignment would set the prototype; the compiled object literal does too). */
export function withOverride(all: Overrides, name: string, entry: Overrides[string]): Overrides {
  const out = { ...all };
  Object.defineProperty(out, name, { value: entry, enumerable: true, writable: true, configurable: true });
  return out;
}

/** The overrides without `name`'s entry ("Reset to default"). */
export function withoutOverride(all: Overrides, name: string): Overrides {
  return Object.fromEntries(Object.entries(all).filter(([k]) => k !== name));
}
