// Copy from the prototype's recipeBody(), recipeAction() and cookSheet().
import type { RecipeFoodResult } from '@plate-and-bar/core';

export const RB_INTRO = 'Start from a typical home-style recipe';
export const OIL_HINT = 'Oil and ghee are the biggest hidden calories in home cooking.';
export const UNITS_HINT = '1 tsp oil ≈ 5 g, 1 tbsp ≈ 15 g. Weigh dals and rice dry.';
export const NO_YIELD_HINT = 'Add how much it made to get per-katori numbers.';
export const OIL_LABELS = { low: 'Light', normal: 'Normal', rich: 'Rich' } as const;
export const SAVE_FAILED = 'Couldn’t save that. Try again.';
export const LOAD_FAILED = 'Couldn’t read your saved recipes.';

export const problem = (r: Exclude<RecipeFoodResult, { kind: 'ok' }>): string =>
  ({
    'no-name': 'Give the recipe a name.',
    'name-too-long': 'That name is too long. Keep it under 200 characters.',
    invalid: 'An amount can’t be below 0.',
    'no-ingredients': 'Add at least one ingredient with an amount.',
    'no-yield': 'Add how many katoris it made, or the cooked weight.',
  })[r.kind];
