import { labelFood, type LabelDraft, type LabelKey, type LabelLevel, type LabelValues, type ScannedFoodResult } from '@plate-and-bar/core';

/** The fields the review screen shows, in order. The first four are required; fibre and added sugar are optional. */
export const REVIEW_FIELDS = [
  { key: 'kcal', label: 'calories', required: true },
  { key: 'protein_g', label: 'protein', required: true },
  { key: 'carbs_g', label: 'carbs', required: true },
  { key: 'fat_g', label: 'fat', required: true },
  { key: 'fibre_g', label: 'fibre', required: false },
  { key: 'added_sugar_g', label: 'addedSugar', required: false },
] as const satisfies readonly { key: LabelKey; label: string; required: boolean }[];

export type ReviewKey = (typeof REVIEW_FIELDS)[number]['key'];
export type Form = { name: string; unit: string } & Record<ReviewKey, string>;

/** The read the user is reviewing: the main one, or the per-serving alternate. */
export function readOf(draft: LabelDraft, perServing: boolean): LabelDraft {
  const alt = draft.alternate;
  if (!perServing || !alt) return draft;
  const { alternate: _drop, ...rest } = draft;
  return { ...rest, basis: 'per_serving', unit: alt.unit, fields: alt.fields, values: alt.values, warnings: alt.warnings };
}

/** `check`: filled, marked "check this". `empty`: left empty, marked "not read". Only trusted values (high, medium) are filled. */
export function flagOf(level: LabelLevel): 'check' | 'empty' | null {
  return level === 'medium' ? 'check' : level === 'high' ? null : 'empty';
}

/** The form for a read: high and medium values filled, low and missing empty. The name is never read from the photo. */
export function formOf(read: LabelDraft, name = ''): Form {
  const f = { name, unit: read.unit } as Form;
  for (const { key } of REVIEW_FIELDS) {
    const field = read.fields[key];
    f[key] = (field.level === 'high' || field.level === 'medium') && field.value !== undefined ? String(field.value) : '';
  }
  return f;
}

/** "1,234": a comma and exactly three digits could be a thousands separator or a decimal, so it is refused rather than guessed. "12,5" is 12.5. */
export const ambiguousComma = (text: string): boolean => /^\s*\d+,\d{3}\s*$/.test(text);

/** A serving size a food can be saved with when the label did not say what its numbers are per: a number of g or ml. */
export const hasWeight = (unit: string): boolean => /\d\s*(g|ml)\b/i.test(unit);

/** True when Add must wait for a serving size: the basis is unknown, so "1 serving" with no weight would be saved. */
export const needsServing = (read: LabelDraft, f: Form): boolean => read.basis === 'unknown' && !hasWeight(f.unit);

/** The typed form put back into the read, then through core's `labelFood` (the same validator as the barcode review). */
export function foodOf(read: LabelDraft, f: Form): ScannedFoodResult {
  const values: LabelValues = {};
  for (const { key } of REVIEW_FIELDS) {
    if (ambiguousComma(f[key])) continue; // shown as an error on the field; the value stays missing
    const t = f[key].trim().replace(',', '.');
    const v = t === '' ? NaN : Number(t);
    if (Number.isFinite(v)) values[key] = v; // empty or not a number: missing, so Add stays off
  }
  return labelFood({ ...read, unit: f.unit, values }, f.name);
}
