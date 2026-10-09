import type { MealDiet } from '@plate-and-bar/core';

// Copy from the prototype's guidanceHtml().
export const DIET_CHIPS: readonly { key: MealDiet; label: string }[] = [
  { key: 'any', label: 'Everything' },
  { key: 'egg', label: 'Eggetarian' },
  { key: 'veg', label: 'Vegetarian' },
];
export const DIET_WORDS: Record<MealDiet, string> = { any: 'all foods', egg: 'eggetarian foods', veg: 'vegetarian foods' };
export const REACHED = 'You’ve reached today’s calories. If you’re still hungry, pick filling, high-protein foods: curd, sprouts salad, egg whites or a salad.';
export const NO_IDEAS = 'No ideas fit this filter for this meal.';
export const PROTEIN_HARD = 'Protein is hard to reach with these foods within your calories. Whey, egg whites, soya chunks, Greek yogurt or chicken breast close the gap fastest.';
export const FLEX_HINT = 'For a wedding, party or big meal out. The extra is taken off the next few days, never below your minimum.';
export const PLATE_GUIDE = [
  ['Half:', 'sabzi or salad'],
  ['A quarter:', 'protein (dal, paneer, chicken, curd, eggs)'],
  ['A quarter:', 'roti or rice'],
] as const;
export const PLATE_HINT = 'No counting needed. If a meal is missing a protein, a katori of curd or dal is the easiest fix.';
