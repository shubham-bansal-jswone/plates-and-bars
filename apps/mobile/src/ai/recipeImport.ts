import type { Schemas } from '@plate-and-bar/api';
import type { DraftRow } from '../recipes/IngredientRows';

/** The draft the recipe builder opens with, and the lines that could not be matched. */
export interface ImportedRecipe {
  name: string;
  katoris: string;
  rows: DraftRow[];
  steps: string[];
  /** Ingredients to add by hand: the server's `unmatched` plus any matched name this device's raw table lacks. */
  unmatched: string[];
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);
/** Imported grams are whole grams (prototype `String(Math.round(num(i.grams)))`). */
const whole = (n: number): string => String(Math.round(n));

/**
 * The server's draft in the builder's terms (prototype `importRecipe`). A matched ingredient the device's table does not
 * know (the server's content can be newer) is not put in a row the builder would refuse to save; it moves to `unmatched`
 * with its weight, so the user sees it. Amounts are grams (the contract's `unit` is always `g`).
 */
export function importedRecipe(r: Schemas['ImportRecipeResponse'], known: ReadonlySet<string>): ImportedRecipe {
  const rows: DraftRow[] = [];
  const unmatched = [...r.unmatched];
  for (const i of r.ingredients) {
    if (known.has(i.ingredient)) rows.push({ ingredient: i.ingredient, amount: whole(Number(i.amount)), unit: 'g' });
    else unmatched.push(`${i.ingredient} (${whole(Number(i.amount))} g)`);
  }
  return { name: r.name, katoris: r1(r.katoris), rows, steps: r.steps, unmatched };
}
