import type { CustomFoodResult } from '@plate-and-bar/core';
import { fmt } from '../format';

// Messages from the prototype's food sheet, plus the ones for core's decided codes (#150).
export const CUSTOM_MESSAGE: Record<Exclude<CustomFoodResult['kind'], 'ok'>, string> = {
  'no-name': 'Give the food a name.',
  'no-kcal': 'Enter calories or at least one macro.',
  'name-too-long': 'That name is too long. Shorten it.',
  invalid: 'Calories, macros and servings can’t be negative, and servings must be more than 0.',
};

export const UNIT_TOO_LONG = 'That serving size is too long. Shorten it.';
export const GRAMS_HINT = 'Grams are the weight in the brackets on the serving (the dry or ingredient weight, such as “50 g raw”), not the cooked weight.';
export const TOO_SMALL = 'That amount is too small to log. Enter more grams or use servings.';
export const notInGrams = (name: string, unit: string): string => `${name} is measured in ${unit}, not grams. Use servings.`;
export const EATOUT_HINT = 'Rough restaurant estimates; portions and oil vary a lot.';
export const SOURCE_HINT = 'Values are calculated from USDA public-domain ingredient data using standard home recipes (carbs include fibre, as on food labels); paneer, curd and milk follow FSSAI composition standards. Packaged foods (whey, Greek yogurt, makhana) use typical label values; check your pack.';

const andList = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** After a planned item that is no longer in the food list (#434). */
export const PLAN_ITEM_GONE = '(no longer in the food list)';
/** How long a Food toast stays: 2.2 s, longer for a long message (about 60 ms a character) so it can be read. */
export const toastMs = (msg: string): number => Math.max(2200, msg.length * 60);
/** Toast after "Log it" on a planned meal (prototype: `Logged your planned …`), naming plan items no longer in the catalog (#334). */
export function plannedLogged(meal: string, skipped: readonly string[], logged: number): string {
  const m = meal.toLowerCase();
  const seen = new Set<string>();
  skipped = skipped.filter((n) => !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase())); // a repeated name is named once
  if (!skipped.length) return `Logged your planned ${m}`;
  const verb = skipped.length === 1 ? 'isn’t' : 'aren’t';
  if (!logged) return `Couldn’t log your planned ${m}: ${andList(skipped)} ${verb} in the food list any more`;
  return `Logged your planned ${m}, except ${andList(skipped)}, which ${verb} in the food list any more`;
}

/** The "Low on protein" line (prototype `upgradeHtml`); `label` is core's wording of what to add. */
export const lowProtein = (label: string, protein_g: number, kcal: number): string => `Low on protein. Add ${label}: +${fmt(protein_g)} g protein, ${fmt(kcal)} kcal.`;
/** Toast after the one-tap add (prototype: `Added <food>`). */
export const upgradeAdded = (name: string): string => `Added ${name}`;
