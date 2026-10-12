/** Longest serving unit the contract accepts (`UserFood.unit`). */
export const UNIT_MAX = 100;
/** Longest kitchen-test note the contract accepts (`KitchenTest.note`). */
export const NOTE_MAX = 2000;

/** True when the trimmed custom-food serving unit is over `UNIT_MAX` (100) characters: the app asks the user to shorten it (#377). */
export function servingUnitTooLong(unit: string): boolean {
  return unit.trim().length > UNIT_MAX;
}

/** True when a kitchen-test note is over `NOTE_MAX` (2000) characters: the app asks the user to shorten it (#377). A missing note is fine. */
export function kitchenNoteTooLong(note: string | null | undefined): boolean {
  return (note ?? '').length > NOTE_MAX;
}
