// Copy from the prototype's planSheet() and grocerySheet().
export const PLAN_SAVED = 'Meal plan saved. Each meal shows its plan on the Food tab.';
export const GROCERY_NOTE = 'Approximate raw amounts for the whole week. Add spices, oil and staples you already keep at home.';
export const COPIED = 'Grocery list copied';
export const COPY_FAILED = 'Couldn’t copy on this device';
export const planIntro = (kcal: string, protein: number): string =>
  `Built from your targets (${kcal} kcal, ${protein} g protein) and diet filter. A few meals repeat on purpose; tap Swap to change one.`;
