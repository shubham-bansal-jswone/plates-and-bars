import { applyCustomTags, type ExerciseCatalog, type ExerciseTag, type LadderCatalog } from '@plate-and-bar/core';
import exercises from '../../../../content/exercises.json';
import { has, isProtoName } from '../content/own';
import { contentReader, isArrOf, isNum, isNumIn, isObj, isStr, isText, perLoad } from '../content/reader';
import { MUSCLE_CODES, TYPE_LABEL } from './copy';
import { isBlank } from '../text/blank';

/** One exercise's how-to card (content/exercises.json `cards`, long keys). */
export interface ExerciseCard {
  where_to_feel: string;
  setup: string[];
  key_cues: string[];
  common_mistakes: string[];
  breathing?: string;
  easier_version?: string;
  harder_version?: string;
}

export type Catalog = ExerciseCatalog & Pick<LadderCatalog, 'ladders'> & {
  cards: Readonly<Record<string, ExerciseCard>>;
  /** The exercise library by group (prototype `LIB`), the "Add an exercise to avoid" picker's list. */
  library: Readonly<Record<string, readonly string[]>>;
};

/** The app's equipment values (the contract types `ExerciseTags.equipment` as a plain string; its description lists these), in the order the library filter shows them. */
export const EQUIPMENT_CODES: readonly string[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
/** Core's `ExType` values (the keys of `TYPE_LABEL`, which is typed by it). */
const TYPE_CODES: readonly string[] = Object.keys(TYPE_LABEL);

// Rules mirror tools/validate/exercises.mjs (the content spec): tag fields and difficulty 1 to 3, muscles from the contract
// enum, primary not empty, meta type from ExType and positive integer reps with low <= high, no unknown meta or card
// fields, cards with every list non-empty (misplaced_feel too), a card for every exercise a ladder, away entry or library
// group uses, and tags and meta naming the same exercises. Skipped: templates (plan content, not in this bundle). Added for
// a stored copy: limits for what the spec leaves open (shipped maxima: reps 60, names 28 characters, card lines 91, 71
// exercises, 8 library groups), trimmed text, no Object.prototype names as keys, and the pins below.
const NAME_MAX = 200;
const KEY_MAX = 60;
const LINE_MAX = 1000;
const LIST_MAX = 100;
const LIBRARY_GROUP_MAX = 1000;
const REPS_MAX = 200;
const trimmed = (max: number) => (v: unknown): v is string => isText(max)(v) && !isBlank(v);
/** Names and keys are compared exactly, so 'Goblet Squat ' must not become a second exercise: no leading or trailing whitespace. */
const exact = (max: number) => (v: unknown): v is string => trimmed(max)(v) && v === v.trim();
const name = exact(NAME_MAX);
const key = exact(KEY_MAX);
const line = trimmed(LINE_MAX);
/** An exercise name or a pattern, family, joint, ladder or group key: trimmed text, never an Object.prototype name. */
const safeName = (v: unknown): v is string => name(v) && !isProtoName(v);
const safeKey = (v: unknown): v is string => key(v) && !isProtoName(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isRec = (v: unknown): v is Record<string, unknown> => isObj(v) && Object.keys(v).length > 0;
const isList = <T,>(ok: (x: unknown) => x is T) => (v: unknown): v is T[] => isArrOf(v, ok) && v.length <= LIST_MAX;
const isMuscle = (v: unknown): v is string => isStr(v) && MUSCLE_CODES.includes(v);
const onlyKeys = (v: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(v).every((k) => allowed.includes(k));

const isTag = (v: unknown): boolean =>
  isObj(v) && safeKey(v.pattern) && safeKey(v.family) && isStr(v.equipment) && EQUIPMENT_CODES.includes(v.equipment) &&
  isInt(v.difficulty) && v.difficulty >= 1 && v.difficulty <= 3 &&
  isList(isMuscle)(v.primary) && v.primary.length > 0 && isList(isMuscle)(v.secondary) && isList(safeKey)(v.joints);

const isMeta = (v: unknown): boolean =>
  isObj(v) && onlyKeys(v, ['type', 'rep_low', 'rep_high']) && isStr(v.type) && TYPE_CODES.includes(v.type) && isInt(v.rep_low) && isInt(v.rep_high) &&
  isNumIn(1, REPS_MAX)(v.rep_low) && isNumIn(1, REPS_MAX)(v.rep_high) && v.rep_low <= v.rep_high;

const isPair = (v: unknown): v is string[] => Array.isArray(v) && v.length === 2 && v.every(line);
const nonEmptyList = <T,>(ok: (x: unknown) => x is T) => (v: unknown): v is T[] => isList(ok)(v) && v.length > 0;
const isCard = (v: unknown): boolean =>
  isObj(v) && onlyKeys(v, ['where_to_feel', 'setup', 'key_cues', 'common_mistakes', 'misplaced_feel', 'breathing', 'easier_version', 'harder_version']) &&
  line(v.where_to_feel) && nonEmptyList(line)(v.setup) && nonEmptyList(line)(v.key_cues) && nonEmptyList(line)(v.common_mistakes) &&
  nonEmptyList(isPair)(v.misplaced_feel) &&
  [v.breathing, v.easier_version, v.harder_version].every((x) => x === undefined || line(x));

const allValues = (v: unknown, ok: (x: unknown) => boolean): boolean => isRec(v) && Object.values(v).every(ok);

/** Shape and bounds of the whole exercises bundle, as far as core and the screens read it. */
function isShape(v: unknown): v is Catalog {
  if (!isObj(v) || !allValues(v.tags, isTag) || !allValues(v.meta, isMeta) || !allValues(v.cards, isCard)) return false;
  const tags = v.tags as Record<string, unknown>;
  const meta = v.meta as Record<string, unknown>;
  const cards = v.cards as Record<string, unknown>;
  const known = (n: unknown): n is string => isStr(n) && has(tags, n);
  const names = Object.keys(tags);
  if (!names.every(safeName) || names.length !== Object.keys(meta).length || !names.every((n) => has(meta, n))) return false;
  if (!Object.keys(cards).every(safeName)) return false;
  // Everything a ladder, away entry or library group names needs a card, as the spec has it.
  const need = (n: string): boolean => has(cards, n);
  const seen = new Set<string>();
  // Ladders: an exercise sits on one step of one ladder (core's `ladderOf` returns the first ladder holding a name).
  const isLadder = (l: unknown): boolean =>
    isObj(l) && name(l.label) && Array.isArray(l.steps) && l.steps.length > 0 && l.steps.length <= LIST_MAX &&
    l.steps.every((st) => Array.isArray(st) && st.length > 0 && st.length <= LIST_MAX && st.every((n) => known(n) && need(n) && !seen.has(n) && !!seen.add(n)));
  if (!allValues(v.ladders, isLadder) || !Object.keys(v.ladders as object).every(safeKey)) return false;
  // Away map: dumbbells column goes to dumbbell or bodyweight exercises, bodyweight column to bodyweight ones; null leaves it out.
  const equipment = (n: string): string => (tags[n] as { equipment: string }).equipment;
  const column = (x: unknown, allowed: readonly string[]): boolean => x === null || (known(x) && need(x) && allowed.includes(equipment(x)));
  if (!isObj(v.away_map) || !allValues(v.away_map.dumbbells_bodyweight, (p) => Array.isArray(p) && p.length === 2 && column(p[0], ['dumbbell', 'bodyweight']) && column(p[1], ['bodyweight']))) return false;
  if (!Object.keys(v.away_map.dumbbells_bodyweight as object).every((n) => known(n) && need(n))) return false;
  if (!allValues(v.library, (g) => Array.isArray(g) && g.length > 0 && g.length <= LIBRARY_GROUP_MAX && g.every((n) => known(n) && need(n))) || !Object.keys(v.library as object).every(safeKey)) return false;
  return true;
}

const shipped = exercises as unknown as Catalog;
const shippedNames = Object.keys(shipped.tags);

/** The shipped meta type and equipment of every shipped exercise. Progression, the unit shown and which exercises a home session may use follow them. */
const shippedFixed = Object.entries(shipped.tags).map(([n, t]) => [n, t.equipment, shipped.meta[n]!.type] as const);
const shippedAway = Object.keys(shipped.away_map.dumbbells_bodyweight);
const shippedLadders = Object.entries(shipped.ladders);
const sameOrder = (stored: readonly string[], base: readonly string[]): boolean => stored.filter((k) => base.includes(k)).join('\u0000') === base.join('\u0000');

/**
 * A stored exercises copy must be valid in every row and keep what the shipped copy fixes, because stored workouts, sets,
 * lift stats, exclusions and swaps refer to exercises by name and core reads the rest:
 * - every shipped exercise, with its shipped `meta.type` and `tags.equipment` (a changed type rereads lift history as
 *   assistance or seconds; a changed equipment sends a barbell lift into a home session); rep ranges and other tag edits are allowed;
 * - the shipped order of tags (`focusPick` breaks ties by it);
 * - every shipped away entry;
 * - every shipped ladder in its order, each shipped step keeping its names first and in order; steps and ladders may be appended.
 * Additions and value edits are otherwise fine; a removal, rename or change of those rejects the whole copy.
 */
const isExercises = (v: unknown): v is Catalog => {
  if (!isShape(v)) return false;
  const tags = v.tags as Record<string, { equipment: string }>;
  if (!shippedFixed.every(([n, eq, type]) => has(tags, n) && tags[n]!.equipment === eq && v.meta[n]?.type === type)) return false;
  if (!sameOrder(Object.keys(tags), shippedNames)) return false;
  const away = v.away_map.dumbbells_bodyweight;
  if (!shippedAway.every((n) => has(away, n))) return false;
  if (!sameOrder(Object.keys(v.ladders), Object.keys(shipped.ladders))) return false;
  return shippedLadders.every(([id, l]) => l.steps.every((st, i) => st.every((n, j) => v.ladders[id]?.steps[i]?.[j] === n)));
};

/** The single accept or reject decision for the exercises bundle: the catalog and the library both read this. */
export const chosenExercises = contentReader('exercises', shipped, isExercises);

const baseCatalog: () => Catalog = perLoad(() => chosenExercises());

// The user's custom exercises (Settings.custom_tags, prototype customTags), set by the settings store. Entries come from
// sync too, so each is checked with the content's own tag rule and a bad one is left out (#312).
let customTags: Readonly<Record<string, ExerciseTag>> = {};
let customSource: unknown = null;
let applied: { base: Catalog; tags: typeof customTags; catalog: Catalog } | null = null;

/** Sets the custom exercise tags from the settings record (unchanged input is a no-op). */
export function setCustomTags(raw: unknown): void {
  if (raw === customSource) return;
  customSource = raw;
  const next: Record<string, ExerciseTag> = {};
  if (isObj(raw)) {
    for (const [name, t] of Object.entries(raw)) {
      if (has(raw, name) && !isProtoName(name) && trimmed(NAME_MAX)(name) && name === name.trim() && isTag(t)) next[name] = t as ExerciseTag;
    }
  }
  customTags = next;
}

/** The exercise content with the user's custom exercises added (core `applyCustomTags`). Call it where it is used, not at module level. */
export function getCatalog(): Catalog {
  const base = baseCatalog();
  if (!Object.keys(customTags).length) return base; // no custom exercises: the content itself, same reference
  if (!applied || applied.base !== base || applied.tags !== customTags) applied = { base, tags: customTags, catalog: applyCustomTags(base, customTags) };
  return applied.catalog;
}
