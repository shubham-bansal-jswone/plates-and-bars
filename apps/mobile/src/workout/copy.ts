import labels from '../../../../content/labels.json';
import type { Schemas } from '@plate-and-bar/api';
import { has, isProtoName, ownOr } from '../content/own';
import { contentReader, isObj, isText } from '../content/reader';
import type { ModsNotePart, Checkin, CheckinReason, ExType, Rate } from '@plate-and-bar/core';
import { isBlank } from '../text/blank';

// Display text from the prototype's workout screen (TYPE_LABEL, MUSCLE, RATES, CI_Q).

export const TYPE_LABEL: Record<ExType, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  machine: 'Machine',
  cable: 'Cable',
  assisted: 'Assisted machine',
  bodyweight: 'Bodyweight',
  other: 'Other',
  time: 'Timed hold',
};

/** The label bundle (content/labels.json) as the screens read it. */
export interface Labels {
  muscles: Record<string, string>;
  joints: Record<string, string>;
  families: Record<string, string>;
  patterns: Record<string, string>;
  replacement_reasons: { works: string; same_movement: string; spares_joint: string; easier_on_joints: string; easier_to_learn: string; done_before: string };
}

const CONTRACT_MUSCLES = ['chest', 'front-delt', 'side-delt', 'rear-delt', 'triceps', 'lats', 'upper-back', 'biceps', 'forearms', 'quads', 'hams', 'glutes', 'calves', 'abs', 'lower-back'] as const satisfies readonly Schemas['Muscle'][];
// Fails to compile when the contract adds a muscle this list lacks.
const _everyMuscleListed: Exclude<Schemas['Muscle'], (typeof CONTRACT_MUSCLES)[number]> extends never ? true : never = true;
void _everyMuscleListed;
/** Contract `Muscle` enum (openapi.yaml): every one needs a label, and tags may use only these. */
export const MUSCLE_CODES: readonly string[] = CONTRACT_MUSCLES;
const REASON_KEYS = ['works', 'same_movement', 'spares_joint', 'easier_on_joints', 'easier_to_learn', 'done_before'];
// Rules mirror tools/validate/cards.mjs `validateLabels`: each group a non-empty object, every label non-blank text, no two
// labels in a group alike, every reason present. Skipped: that every family and pattern an exercise uses has a label (a
// cross-bundle check would break "each bundle is wholly used or wholly rejected"; a key without a label reads as the raw key).
// Added for a stored copy: limits (shipped maxima: labels 28 characters, 25 families), no Object.prototype names as keys,
// and the shipped keys.
const LABEL_MAX = 200;
const KEYS_MAX = 200;
const KEY_MAX = 60;
const shippedLabels = labels as unknown as Labels;
const label = (v: unknown): v is string => isText(LABEL_MAX)(v) && !isBlank(v);

/** A record of at most `KEYS_MAX` own keys (never empty: `must` is not) (1 to 60 characters, not Object.prototype names) with distinct label values, holding every key in `must`. */
function isLabelMap(v: unknown, must: readonly string[]): boolean {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return (
    keys.length <= KEYS_MAX && keys.every((k) => isText(KEY_MAX)(k) && !isBlank(k) && !isProtoName(k) && label(v[k])) &&
    new Set(keys.map((k) => v[k])).size === keys.length && must.every((k) => has(v, k))
  );
}

/** A reason text holds exactly the `{...}` places `tokens` lists, once each, and no other brace. */
const placeholders = (t: unknown, tokens: readonly string[]): boolean => {
  if (!label(t)) return false;
  const found = t.match(/\{[^}]*\}/g) ?? [];
  return found.join() === tokens.join() && !t.replace(/\{[^}]*\}/g, '').match(/[{}]/);
};

/**
 * A stored labels copy must hold a label for every contract muscle and keep every key the shipped copy has (stored rules
 * refer to joints, families and patterns by key). Additions and edits are fine. `works` keeps exactly one `{muscles}`,
 * `spares_joint` exactly one `{joint}`, and no reason text has another `{...}` place.
 */
const isLabels = (v: unknown): v is Labels => {
  if (!isObj(v) || !isLabelMap(v.muscles, MUSCLE_CODES)) return false;
  for (const g of ['joints', 'families', 'patterns'] as const) if (!isLabelMap(v[g], Object.keys(shippedLabels[g]))) return false;
  const r = v.replacement_reasons;
  return isObj(r) && REASON_KEYS.every((k) => placeholders(r[k], k === 'works' ? ['{muscles}'] : k === 'spares_joint' ? ['{joint}'] : []));
};

/** The single accept or reject decision for the labels bundle: copy, rules text, reasons and the library all read it. */
export const chosenLabels = contentReader('labels', shippedLabels, isLabels);
/** The labels. Call it where it is used, not at module level. */
export const getLabels = (): Labels => chosenLabels();
/** A muscle's label, or the code itself. */
export const muscleName = (m: string): string => ownOr(getLabels().muscles, m);

export const RATE_LABEL: Record<Rate, string> = { easy: 'Easy', right: 'Just right', hard: 'Hard', fail: 'Couldn’t finish' };
export const RATE_ORDER: Rate[] = ['easy', 'right', 'hard', 'fail'];

type Question = { [K in keyof Checkin]-?: { key: K; label: string; options: [NonNullable<Checkin[K]>, string][] } }[keyof Checkin];

export const CHECKIN: Question[] = [
  { key: 'sleep', label: 'Sleep last night', options: [['good', 'Good'], ['ok', 'OK'], ['poor', 'Poor']] },
  { key: 'sore', label: 'Soreness in today’s muscles', options: [['none', 'None'], ['some', 'Some'], ['very', 'Very sore']] },
  { key: 'energy', label: 'Energy', options: [['good', 'Good'], ['ok', 'OK'], ['low', 'Low']] },
  { key: 'time', label: 'Time today', options: [['usual', 'Usual'], ['45', '45 min'], ['30', '30 min']] },
];

/** The words for each reason the check-in suggests a lighter session. */
export const REASON_TEXT: Record<CheckinReason, string> = { sleep: 'poor sleep', energy: 'low energy', sore: 'very sore muscles' };

/** "a, b and c". Mirrors the prototype's `listJoin`. */
export function listJoin(a: string[]): string {
  return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/** Copy for one part of the "Today: …" note (core's `modsNote` gives the codes). */
export function modsNoteText(p: ModsNotePart): string {
  switch (p.kind) {
    case 'deload':
      return 'recovery week: fewer sets, about 10% lighter';
    case 'reentry':
      return `easing back in: about ${p.pct}% lighter`;
    case 'light':
      return 'lighter session: 1 fewer set, no weight increases';
    case 'short':
      return 'short session: main exercises only';
    case 'where':
      return p.where === 'dumbbells' ? 'dumbbells-only version' : 'bodyweight version';
  }
}
