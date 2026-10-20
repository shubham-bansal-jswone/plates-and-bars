// Validates content/labs.json: the copy for lab reports (#1070). Informational wording only; core holds no copy.
import { nonEmpty } from './text.mjs';

export const LAB_MARKER_KEYS = ['vitamin_d', 'vitamin_b12', 'iron_ferritin', 'haemoglobin', 'ldl', 'hdl', 'triglycerides', 'hba1c', 'glucose', 'tsh', 'creatinine', 'alt', 'ast', 'uric_acid'];
export const LAB_TEXT_KEYS = ['not_medical_advice', 'intro', 'check_values', 'red_notice', 'generic_notice', 'unit_unrecognised', 'all_within_range', 'hold_title', 'hold_body', 'workout_note'];
const MAX = 600;

export function validateLabs(content) {
  const errors = [];
  if (content?.schema_version !== 1) errors.push('schema_version must be 1');
  for (const k of LAB_TEXT_KEYS) {
    const v = content?.[k];
    if (!nonEmpty(v)) errors.push(`${k} missing`);
    else if (v.length > MAX) errors.push(`${k} is longer than ${MAX} characters`);
  }
  // The not-medical-advice line is a safety statement: it must say so and point to a doctor.
  const nma = String(content?.not_medical_advice ?? '');
  if (!/not medical advice/i.test(nma) || !/doctor/i.test(nma)) errors.push('not_medical_advice must say it is not medical advice and name a doctor');
  const markers = content?.markers;
  if (markers === null || typeof markers !== 'object' || Array.isArray(markers)) return [...errors, 'markers must be an object'];
  for (const k of LAB_MARKER_KEYS) if (!(k in markers)) errors.push(`marker '${k}' missing`);
  for (const [k, tips] of Object.entries(markers)) {
    const at = `marker '${k}'`;
    if (!LAB_MARKER_KEYS.includes(k)) errors.push(`${at}: unknown marker`);
    const sides = Object.keys(tips ?? {});
    if (sides.length === 0) errors.push(`${at}: needs at least one tip`);
    for (const s of sides) {
      if (s !== 'low' && s !== 'high') errors.push(`${at}: tip side '${s}' must be low or high`);
      else if (!nonEmpty(tips[s])) errors.push(`${at}: ${s} tip is empty`);
      else if (tips[s].length > MAX) errors.push(`${at}: ${s} tip is longer than ${MAX} characters`);
    }
  }
  return errors;
}
