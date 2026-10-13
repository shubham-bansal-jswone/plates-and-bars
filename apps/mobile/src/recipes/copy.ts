// Copy from the prototype's recipeBody(), recipeAction() and cookSheet().
import { FIT_SOYA_G, type FitSuggestion, type RecipeFoodResult } from '@plate-and-bar/core';
import { fmt } from '../format';

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

export const FIT_LABEL = 'Make it fit';
/** The suggestion line, from the prototype's `fitSuggestions()`. */
export const fitLine = (s: FitSuggestion): string =>
  s.kind === 'fit-oil' ? `Use half the oil or ghee: about −${fmt(s.kcal_saved)} kcal per katori` : `Add ${FIT_SOYA_G} g soya chunks: about +${fmt(s.protein_added_g)} g protein per katori`;
