import type { CustomFoodResult } from '@plate-and-bar/core';

// Messages from the prototype's food sheet, plus the ones for core's decided codes (#150).
export const CUSTOM_MESSAGE: Record<Exclude<CustomFoodResult['kind'], 'ok'>, string> = {
  'no-name': 'Give the food a name.',
  'no-kcal': 'Enter calories or at least one macro.',
  'name-too-long': 'That name is too long. Shorten it.',
  invalid: 'Calories, macros and servings can’t be negative, and servings must be more than 0.',
};

export const GRAMS_HINT = 'Grams are the weight in the brackets on the serving (the dry or raw weight, such as “50 g raw”), not the cooked weight.';
export const TOO_SMALL = 'That amount is too small to log. Enter more grams or use servings.';
export const notInGrams = (name: string, unit: string): string => `${name} is measured in ${unit}, not grams. Use servings.`;
export const EATOUT_HINT = 'Rough restaurant estimates; portions and oil vary a lot.';
