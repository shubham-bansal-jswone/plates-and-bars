import type { Schemas } from '@plate-and-bar/api';
import type { ExerciseTag } from '@plate-and-bar/core';
import { has } from '../content/own';
import { EQUIPMENT_CODES } from './catalog';
import { getLabels, MUSCLE_CODES } from './copy';

/** The prototype's no-AI tags (`tagSheet` fallback): pattern `h-press`, family `custom`, equipment `machine`, difficulty 2, no muscles or joints. */
export const FALLBACK_TAGS: ExerciseTag = { pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: [], secondary: [], joints: [] };

/** What the contract's `SuggestTagsResponse.equipment` allows: the app's equipment values without `other`. */
const EQUIPMENT = EQUIPMENT_CODES.filter((e) => e !== 'other');
const keep = (list: unknown, ok: (x: string) => boolean, max: number): string[] => {
  const out: string[] = [];
  for (const x of Array.isArray(list) ? list : []) if (typeof x === 'string' && ok(x) && !out.includes(x) && out.length < max) out.push(x);
  return out;
};

/**
 * The model's reply as tags, the way the prototype's `suggestTags` reads it: an unknown pattern, equipment or difficulty
 * takes the fallback, muscles and joints are kept only if known (muscles at most 3 each), and a reply with no main muscle
 * is no suggestion (null), so the sheet shows the manual picker.
 */
export function tagsFromSuggestion(r: Schemas['SuggestTagsResponse']): ExerciseTag | null {
  const { patterns, joints } = getLabels();
  const primary = keep(r.primary, (m) => MUSCLE_CODES.includes(m), 3);
  if (!primary.length) return null;
  return {
    pattern: typeof r.pattern === 'string' && has(patterns, r.pattern) ? r.pattern : FALLBACK_TAGS.pattern,
    family: FALLBACK_TAGS.family,
    equipment: EQUIPMENT.includes(r.equipment) ? r.equipment : FALLBACK_TAGS.equipment,
    difficulty: r.difficulty === 1 || r.difficulty === 2 || r.difficulty === 3 ? r.difficulty : FALLBACK_TAGS.difficulty,
    primary,
    secondary: keep(r.secondary, (m) => MUSCLE_CODES.includes(m), 3),
    joints: keep(r.joints, (j) => has(joints, j), Infinity),
  };
}
