import { formatWeight, parseWeightInput, type WeightUnit } from '@plate-and-bar/core';

/**
 * Set rows keep their weight as kg text, exactly as stored (#1185): the stored value, sync, volume and the lift record all read it.
 * Only the field on screen is in the display unit, and only a field the user edits is written back, so a kg value shown as lb and
 * left alone is never re-saved. These two functions are the whole conversion edge; the arithmetic is core's.
 */

/** The text a set row's weight field shows: the stored kg text in `unit`, rounded as core's `formatWeight` does. kg is shown as stored. */
export function weightFieldText(kgText: string, unit: WeightUnit): string {
  if (kgText.trim() === '') return kgText;
  const kg = Number(kgText);
  if (!Number.isFinite(kg)) return kgText;
  // kg is shown as stored, except a value that came from lb (`61.23496995`) is rounded like every shown weight.
  return unit === 'kg' && !/\.\d{3,}/.test(kgText) ? kgText : formatWeight(kg, unit);
}

/**
 * The kg text for what was typed in `unit`, or null when it is not one plain number (the caller keeps the field empty then). Zero and up;
 * the contract gives a set's `weight_kg` a minimum of 0 and no maximum. kg passes the text through untouched, as before the setting existed.
 */
export function weightFromField(typed: string, unit: WeightUnit): string | null {
  if (unit === 'kg') return typed;
  if (typed.trim() === '') return '';
  // A number still being typed counts, as in kg: "135." is 135 and ".5" is 0.5 (one separator, at the end or the start).
  const t = typed.trim();
  const kg = parseWeightInput(/^\d+[.,]$/.test(t) ? t.slice(0, -1) : /^[.,]\d+$/.test(t) ? `0${t}` : t, unit);
  return kg === null ? null : String(kg);
}

/** A weight row as core's unit-aware helpers expect it: weight text in `unit`. */
export function displayRow<T extends { w: string }>(row: T, unit: WeightUnit): T {
  return unit === 'kg' ? row : { ...row, w: weightFieldText(row.w, unit) };
}
