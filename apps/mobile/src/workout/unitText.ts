import { formatWeight, parseWeightInput, type WeightUnit } from '@plate-and-bar/core';

/**
 * Set rows keep their weight as kg text, exactly as stored (#1185): the stored value, sync, volume and the lift record all read it.
 * Only the field on screen is in the display unit, and only a field the user edits is written back, so a kg value shown as lb and
 * left alone is never re-saved. These two functions are the whole conversion edge; the arithmetic is core's.
 */

/** The text a set row's weight field shows: the stored kg text in `unit`, rounded as core's `formatWeight` does. kg is shown as stored. */
export function weightFieldText(kgText: string, unit: WeightUnit): string {
  if (unit === 'kg' || kgText.trim() === '') return kgText;
  const kg = Number(kgText);
  return Number.isFinite(kg) ? formatWeight(kg, unit) : kgText;
}

/**
 * The kg text for what was typed in `unit`, or null when it is not one plain number (the caller keeps the field empty then). Zero and up;
 * the contract gives a set's `weight_kg` a minimum of 0 and no maximum. kg passes the text through untouched, as before the setting existed.
 */
export function weightFromField(typed: string, unit: WeightUnit): string | null {
  if (unit === 'kg') return typed;
  if (typed.trim() === '') return '';
  const kg = parseWeightInput(typed, unit);
  return kg === null ? null : String(kg);
}

/** A weight row as core's unit-aware helpers expect it: weight text in `unit`. */
export function displayRow<T extends { w: string }>(row: T, unit: WeightUnit): T {
  return unit === 'kg' ? row : { ...row, w: weightFieldText(row.w, unit) };
}
