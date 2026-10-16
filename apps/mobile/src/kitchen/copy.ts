// Copy from the prototype's ktSheet(), ktResultHtml(), ktListHtml() and ktSave().
import type { KitchenComparison, KitchenTestFoodResult } from '@plate-and-bar/core';
import { fmt } from '../format';

export const HOW_TO = [
  'Use a kitchen scale. Weigh every raw ingredient before cooking, especially oil and ghee. Weigh dals and rice dry.',
  'Weigh the empty pot before you start.',
  'After cooking, weigh the pot with the food in it. The difference is the cooked weight.',
  'Serve one normal portion into your usual katori or plate and weigh just the food.',
];
export const HOW_TO_HINT = 'Cook the dish the way you normally do; the point is real home portions.';
export const NOT_READY_HINT = 'Add the cooked weight (or the pot weights) to see the results.';
export const NO_SERVING_HINT = 'Weigh one serving to get per-serving numbers.';
export const BAD_DATE = 'Use a date like 2026-10-08.';
export const SAVE_FAILED = 'Couldn’t save that. Try again.';
export const LOAD_FAILED = 'Couldn’t read your saved kitchen tests.';
export const listIntro = (n: number): string =>
  `Weigh dishes as you cook to build your own food data: real home portions, oil included. ${n ? `${n} dish${n > 1 ? 'es' : ''} tested.` : 'Start with dal, roti, rice, sabzi, poha, idli and dosa.'}`;

export const NOTE_TOO_LONG = 'That note is too long. Shorten it.';
export const problem = (r: Exclude<KitchenTestFoodResult, { kind: 'ok' | 'no-serving' }>): string =>
  ({
    'no-name': 'Name the dish.',
    'name-too-long': 'That name is too long. Keep it under 200 characters.',
    invalid: 'An amount or weight can’t be below 0.',
    'no-ingredients': 'Add the raw ingredients with their weights.',
    'not-ready': 'Add the cooked weight, or both pot weights.',
  })[r.kind];

export const COPY_TABLE = 'Copy all as a table';
export const TABLE_COPIED = 'Copied. Paste into a spreadsheet.';
export const TABLE_COPY_FAILED = 'Couldn’t copy on this device';
/** The line under the results (prototype `ktResultHtml` `cmp`). */
export const compareLine = (c: KitchenComparison): string =>
  `The app’s current value for ${c.food.name} (${c.food.unit}) is ${fmt(c.food.kcal)} kcal; your dish is ${c.diff_kcal >= 0 ? '+' : '−'}${fmt(Math.abs(c.diff_kcal))} kcal per serving.`;

export const PHOTO_ADD = 'Add a photo of the serving';
export const PHOTO_ADDED = 'Photo added';
export const PHOTO_SAVE_FAILED = 'The test is saved, but the photo could not be. Try adding it again.';
export const PHOTO_CAMERA_OFF = 'Camera access is off for this app. Choose a photo instead, or turn it on in Settings.';
export const PHOTO_HINT = 'The photo stays on this device.';
export const PHOTO_PICK_FAILED = 'Couldn’t add that photo. Try again.';
