import { num } from './num';
import type { ExType, SettingsExerciseOverride } from './progression';

/**
 * The equipment chips of the exercise settings sheet, in the prototype's order. `other` is not offered: it is only the
 * type of an exercise the catalogue does not know. Mirrors the type list in prototype `renderExSettings()`.
 */
export const EXERCISE_SHEET_TYPES: readonly ExType[] = Object.freeze(['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight', 'time'] as const);

/**
 * The "Smallest weight jump" chips of the exercise settings sheet, in kg. The sheet hides them for types with no load
 * (`noLoad`: bodyweight and timed holds); picking a type starts at its `DEFAULT_STEP`. Mirrors `steps` in prototype
 * `renderExSettings()`.
 */
export const EXERCISE_STEP_CHOICES: readonly number[] = Object.freeze([1, 1.25, 2, 2.5, 5, 10]);

/**
 * The same chips for an lb user, in pounds: plates and stacks come in lb, so these are their own list, not the kg list converted. The sheet stores
 * the step as the exact kg (`lbToKg`); `lbStepFor` reads each back as the same lb step.
 */
export const LB_STEP_CHOICES: readonly number[] = Object.freeze([2.5, 5, 10]);

/** What the exercise settings sheet holds when the user taps Save (prototype `ES.v` and the `#esLo`/`#esHi` boxes). */
export interface ExerciseSettingsDraft {
  type: ExType;
  /** Weight step in kg: a chip of `EXERCISE_STEP_CHOICES`, or the type's `DEFAULT_STEP`. */
  step: number;
  /** The "Range low" box as typed. */
  lo: string;
  /** The "Range high" box as typed. */
  hi: string;
}

/**
 * `ok` with the contract `Settings.exercise_overrides` entry to save; `invalid-range` when the range is refused (the
 * prototype's toast "Set a valid range, like 8 to 12."); `invalid-step` when the step is not a number of at least 0
 * (the sheet's chips and defaults never give one).
 */
export type ExerciseOverrideResult = { kind: 'ok'; entry: SettingsExerciseOverride } | { kind: 'invalid-range' } | { kind: 'invalid-step' };

/**
 * Builds the override the exercise settings sheet saves. Each box is read as the prototype reads it,
 * `Math.round(num(text))`, so "8,5" is 9 and a blank or unreadable box is 0. The range must fit the contract
 * (`rep_low`, `rep_high`: whole numbers of at least 1) with low not above high, so blank and 0 are refused as in the
 * prototype.
 *
 * Mirrors the `es-save` step of prototype `workoutAction`, except that a low below 1 is refused: the prototype's
 * `!lo || !hi || lo > hi` saves a low of -3, which the contract refuses (decided on #620, #200).
 */
export function exerciseOverrideEntry(draft: ExerciseSettingsDraft): ExerciseOverrideResult {
  const lo = Math.round(num(draft.lo)), hi = Math.round(num(draft.hi));
  if (lo < 1 || lo > hi) return { kind: 'invalid-range' };
  if (!Number.isFinite(draft.step) || draft.step < 0) return { kind: 'invalid-step' };
  return { kind: 'ok', entry: { type: draft.type, step_kg: draft.step, rep_low: lo, rep_high: hi } };
}
