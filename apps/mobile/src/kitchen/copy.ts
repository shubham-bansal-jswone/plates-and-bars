// Copy from the prototype's ktSheet(), ktResultHtml(), ktListHtml() and ktSave().
import type { KitchenTestFoodResult } from '@plate-and-bar/core';

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

export const problem = (r: Exclude<KitchenTestFoodResult, { kind: 'ok' | 'no-serving' }>): string =>
  ({
    'no-name': 'Name the dish.',
    'name-too-long': 'That name is too long. Keep it under 200 characters.',
    invalid: 'An amount or weight can’t be below 0.',
    'no-ingredients': 'Add the raw ingredients with their weights.',
    'not-ready': 'Add the cooked weight, or both pot weights.',
  })[r.kind];
