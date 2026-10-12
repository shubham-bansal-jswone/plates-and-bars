import labels from '../../../../content/labels.json';
import { contentReader, isObj, isText } from '../content/reader';
import type { ModsNotePart, Checkin, CheckinReason, ExType, Rate } from '@plate-and-bar/core';

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

/** Contract `Muscle` enum (openapi.yaml): every one needs a label, and tags may use only these. */
export const MUSCLE_CODES: readonly string[] = ['chest', 'front-delt', 'side-delt', 'rear-delt', 'triceps', 'lats', 'upper-back', 'biceps', 'forearms', 'quads', 'hams', 'glutes', 'calves', 'abs', 'lower-back'];
const REASON_KEYS = ['works', 'same_movement', 'spares_joint', 'easier_on_joints', 'easier_to_learn', 'done_before'];
// Shipped maxima: labels 28 characters, 25 families. Limits leave headroom.
const LABEL_MAX = 200;
const KEYS_MAX = 200;
const shippedLabels = labels as unknown as Labels;

/** A record of 1 to `KEYS_MAX` keys (1 to 60 characters) with label text values that must hold every key in `must`. */
function isLabelMap(v: unknown, must: readonly string[]): boolean {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return keys.length <= KEYS_MAX && keys.every((k) => isText(60)(k) && isText(LABEL_MAX)(v[k])) && must.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

/**
 * A stored labels copy must hold a label for every contract muscle and keep every key the shipped copy has (stored rules
 * refer to joints, families and patterns by key, and a missing one would read "All undefined"). Additions and edits are
 * fine. The reasons text must keep its `{muscles}` and `{joint}` places.
 */
const isLabels = (v: unknown): v is Labels => {
  if (!isObj(v) || !isLabelMap(v.muscles, MUSCLE_CODES)) return false;
  for (const g of ['joints', 'families', 'patterns'] as const) if (!isLabelMap(v[g], Object.keys(shippedLabels[g]))) return false;
  const r = v.replacement_reasons;
  return isObj(r) && REASON_KEYS.every((k) => isText(LABEL_MAX)(r[k])) && (r.works as string).includes('{muscles}') && (r.spares_joint as string).includes('{joint}');
};

/** The single accept or reject decision for the labels bundle: copy, rules text, reasons and the library all read it. */
export const chosenLabels = contentReader('labels', shippedLabels, isLabels);
/** The labels. Call it where it is used, not at module level. */
export const getLabels = (): Labels => chosenLabels();
/** A muscle's label, or the code itself. */
export const muscleName = (m: string): string => getLabels().muscles[m] ?? m;

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
