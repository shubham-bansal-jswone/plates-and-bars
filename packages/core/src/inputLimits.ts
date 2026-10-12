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
