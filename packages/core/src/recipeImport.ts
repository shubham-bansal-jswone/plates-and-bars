/**
 * Recipe import rule (#1011). Prototype `importRecipe` (plate-and-bar.html line 3105): each matched ingredient becomes a row
 * whose amount is `String(Math.round(num(i.grams)))` (line 3116), whole grams. The app keeps the matching and the draft.
 */
import { num } from './num';

/** An imported ingredient's amount as the recipe builder holds it: grams rounded to a whole number, as text (prototype line 3116). Junk reads as "0". */
export function importedGrams(grams: unknown): string {
  return String(Math.round(num(grams)));
}
