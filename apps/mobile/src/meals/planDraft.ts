import type { MealPlan } from '@plate-and-bar/core';

/** The plan being edited, kept in memory so Back and reopening the screen does not lose unsaved swaps (it is dropped on save and when the app restarts). */
let draft: MealPlan | null = null;
export const getPlanDraft = (): MealPlan | null => draft;
export const setPlanDraft = (p: MealPlan | null): void => {
  draft = p;
};
