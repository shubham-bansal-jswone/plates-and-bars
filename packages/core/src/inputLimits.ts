// Lengths are JavaScript `string.length`, which counts UTF-16 code units. The server counts code points, and a code
// point is one or two units, so `length` is never below the server's count: a text that passes here always passes the
// server (the safe direction). An emoji-heavy text can be refused here a little before the server would refuse it.

/** Longest serving unit the contract accepts (`UserFood.unit`), in UTF-16 code units (see above). */
export const UNIT_MAX = 100;
/** Longest kitchen-test note the contract accepts (`KitchenTest.note`), in UTF-16 code units (see above). */
export const NOTE_MAX = 2000;

/** True when the trimmed custom-food serving unit is over `UNIT_MAX` (100) UTF-16 code units: the app asks the user to shorten it (#377). */
export function servingUnitTooLong(unit: string): boolean {
  return unit.trim().length > UNIT_MAX;
}

/** True when a kitchen-test note is over `NOTE_MAX` (2000) UTF-16 code units: the app asks the user to shorten it (#377). A missing note is fine. */
export function kitchenNoteTooLong(note: string | null | undefined): boolean {
  return (note ?? '').length > NOTE_MAX;
}

/** Longest custom exercise name the contract accepts (`Settings.custom_tags` keys, `WorkoutExercise.name`), in UTF-16 code units. */
export const EXERCISE_NAME_MAX = 200;

/** True when a trimmed custom exercise name is over `EXERCISE_NAME_MAX` (200) UTF-16 code units: the app asks the user to shorten it (#397). */
export function exerciseNameTooLong(name: string): boolean {
  return name.trim().length > EXERCISE_NAME_MAX;
}

/** Most custom exercises the contract keeps (`Settings.custom_tags` maxProperties): a new one past this is refused (#312). */
export const CUSTOM_EXERCISES_MAX = 500;

/** Most entries the contract keeps in `Settings.exercise_overrides` (maxProperties): a new exercise past this is refused (#620). */
export const EXERCISE_OVERRIDES_MAX = 500;

/**
 * True when saving an override for `name` would take `overrides` past `EXERCISE_OVERRIDES_MAX` (500): `name` has no
 * entry yet and the list is already full. Replacing an existing entry is always allowed (#620). The prototype has no cap.
 */
export function exerciseOverridesWouldExceed(overrides: Readonly<Record<string, unknown>>, name: string): boolean {
  return !Object.prototype.hasOwnProperty.call(overrides, name) && Object.keys(overrides).length >= EXERCISE_OVERRIDES_MAX;
}
