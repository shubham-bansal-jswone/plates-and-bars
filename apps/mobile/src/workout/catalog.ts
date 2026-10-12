import type { ExerciseCatalog, LadderCatalog } from '@plate-and-bar/core';
import exercises from '../../../../content/exercises.json';
import { contentReader, isArrOf, isNum, isNumIn, isObj, isStr, isText, perLoad } from '../content/reader';
import { MUSCLE_CODES, TYPE_LABEL } from './copy';

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

/** Contract `ExerciseTags.equipment` enum, in the order the library filter shows it. */
export const EQUIPMENT_CODES: readonly string[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
/** Core's `ExType` values (the keys of `TYPE_LABEL`, which is typed by it). */
const TYPE_CODES: readonly string[] = Object.keys(TYPE_LABEL);

// Bounds: the contract's (`ExerciseTags`: difficulty integer 1 to 3, equipment and muscle enums) and generous limits for
// what it leaves open (shipped maxima: reps 60, names 28 characters, card lines 91, 71 exercises, 8 library groups).
const NAME_MAX = 200;
const KEY_MAX = 60;
const LINE_MAX = 1000;
const LIST_MAX = 100;
const REPS_MAX = 200;
const name = isText(NAME_MAX);
const key = isText(KEY_MAX);
const line = isText(LINE_MAX);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const isRec = (v: unknown): v is Record<string, unknown> => isObj(v) && Object.keys(v).length > 0;
const isList = <T,>(ok: (x: unknown) => x is T) => (v: unknown): v is T[] => isArrOf(v, ok) && v.length <= LIST_MAX;
const isMuscle = (v: unknown): v is string => isStr(v) && MUSCLE_CODES.includes(v);

const isTag = (v: unknown): boolean =>
  isObj(v) && key(v.pattern) && key(v.family) && isStr(v.equipment) && EQUIPMENT_CODES.includes(v.equipment) &&
  isInt(v.difficulty) && v.difficulty >= 1 && v.difficulty <= 3 &&
  isList(isMuscle)(v.primary) && v.primary.length > 0 && isList(isMuscle)(v.secondary) && isList(key)(v.joints);

const isMeta = (v: unknown): boolean =>
  isObj(v) && isStr(v.type) && TYPE_CODES.includes(v.type) && isInt(v.rep_low) && isInt(v.rep_high) &&
  isNumIn(1, REPS_MAX)(v.rep_low) && isNumIn(1, REPS_MAX)(v.rep_high) && v.rep_low <= v.rep_high;

const isPair = (v: unknown): v is string[] => Array.isArray(v) && v.length === 2 && v.every(line);
const isCard = (v: unknown): boolean =>
  isObj(v) && line(v.where_to_feel) && isList(line)(v.setup) && isList(line)(v.key_cues) && isList(line)(v.common_mistakes) &&
  (v.misplaced_feel === undefined || isList(isPair)(v.misplaced_feel)) &&
  [v.breathing, v.easier_version, v.harder_version].every((x) => x === undefined || line(x));

const allValues = (v: unknown, ok: (x: unknown) => boolean): boolean => isRec(v) && Object.values(v).every(ok);

/** Shape and bounds of the whole exercises bundle, as far as core and the screens read it. */
function isShape(v: unknown): v is Catalog {
  if (!isObj(v) || !allValues(v.tags, isTag) || !allValues(v.meta, isMeta) || !allValues(v.cards, isCard)) return false;
  const tags = v.tags as Record<string, unknown>;
  const meta = v.meta as Record<string, unknown>;
  const known = (n: unknown): boolean => isStr(n) && Object.prototype.hasOwnProperty.call(tags, n);
  const names = Object.keys(tags);
  if (names.length !== Object.keys(meta).length || !names.every((n) => name(n) && Object.prototype.hasOwnProperty.call(meta, n))) return false;
  if (!allValues(v.ladders, (l) => isObj(l) && name(l.label) && Array.isArray(l.steps) && l.steps.length > 0 && l.steps.length <= LIST_MAX && l.steps.every((s) => Array.isArray(s) && s.length > 0 && s.length <= LIST_MAX && s.every(known)))) return false;
  if (!isObj(v.away_map) || !allValues(v.away_map.dumbbells_bodyweight, (p) => Array.isArray(p) && p.length === 2 && p.every((x) => x === null || known(x)))) return false;
  const away = v.away_map.dumbbells_bodyweight as Record<string, unknown>;
  if (!Object.keys(away).every(known)) return false;
  return allValues(v.library, (g) => Array.isArray(g) && g.length > 0 && g.length <= 1000 && g.every(known)) && Object.keys(v.library as object).every(key);
}

const shipped = exercises as unknown as Catalog;
const shippedNames = Object.keys(shipped.tags);

/**
 * A stored exercises copy must be valid in every row and keep every exercise the shipped copy has: stored workouts, sets,
 * lift stats, exclusions and swaps refer to exercises by name. Additions and value edits are fine; a removed or renamed
 * exercise rejects the whole copy.
 */
const isExercises = (v: unknown): v is Catalog => isShape(v) && shippedNames.every((n) => Object.prototype.hasOwnProperty.call(v.tags, n));

/** The single accept or reject decision for the exercises bundle: the catalog and the library both read this. */
export const chosenExercises = contentReader('exercises', shipped, isExercises);

/** The exercise content, passed to core as is. Call it where it is used, not at module level. */
export const getCatalog: () => Catalog = perLoad(() => chosenExercises());
