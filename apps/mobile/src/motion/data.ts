import motions from '../../../../content/exercise-motion.json';
import { isBlank } from '../text/blank';
import { contentReader, isArrOf, isObj, isStr } from '../content/reader';
import { has, isProtoName } from '../content/own';
import { chosenExercises } from '../workout/catalog';
import { ALT_MAX, licenceLabel, sentencesWithin } from '../workout/figures';
import { FRAME_LENGTH, JOINT_NAMES, type MotionClip } from './project';

/** One exercise's keyframes and licence record (content/exercise-motion.json `motions`). Fields the player does not read are not checked. */
export interface MotionEntry extends MotionClip {
  source: string;
  licence: string;
  licence_url: string | null;
  author: string;
  author_url: string | null;
  note: string | null;
}
export interface MotionBundle { schema_version: number; skeleton: string; joints: readonly string[]; motions: Readonly<Record<string, MotionEntry>> }

export const SKELETON_ID = 'pb19-v1';
// These mirror tools/validate/exercise-motion.mjs (a test compares them). The app adds no limit of its own: the tools validator caps an entry at 8,192 bytes.
export const MIN_FPS = 5;
export const MAX_FPS = 30;
export const MIN_FRAMES = 2;
export const MAX_COORD = 2;
/** Own filming or Wikimedia clips only; `synthetic_fixture` is for tests and is never played from content (tools/validate/exercise-motion.mjs refuses it too). */
export const SOURCES = ['own_filming', 'cc_licensed'];
export const LICENCES: Readonly<Record<string, string>> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
const isHttps = (v: unknown): boolean => isStr(v) && v.length <= 2000 && /^https:\/\/[^\s]+$/.test(v);
const nonBlank = (v: unknown): v is string => isStr(v) && !isBlank(v);
const isFrame = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === FRAME_LENGTH && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD);

const isEntry = (v: unknown): v is MotionEntry =>
  isObj(v) && Number.isInteger(v.fps) && (v.fps as number) >= MIN_FPS && (v.fps as number) <= MAX_FPS && typeof v.loop === 'boolean' &&
  Array.isArray(v.frames) && v.frames.length >= MIN_FRAMES && isArrOf(v.frames, isFrame) &&
  isStr(v.source) && SOURCES.includes(v.source) && isStr(v.licence) && has(LICENCES, v.licence) && v.licence_url === LICENCES[v.licence] &&
  nonBlank(v.author) && (v.author_url === null || isHttps(v.author_url)) && (v.note === null || nonBlank(v.note));

/** Shape and safety of the whole bundle. An empty `motions` is valid (the bundle ships empty until the coach has signed off clips). */
export function isMotionBundle(v: unknown): v is MotionBundle {
  if (!isObj(v) || v.schema_version !== 1 || v.skeleton !== SKELETON_ID || !isObj(v.motions)) return false;
  if (!Array.isArray(v.joints) || v.joints.length !== JOINT_NAMES.length || !JOINT_NAMES.every((n, i) => (v.joints as unknown[])[i] === n)) return false;
  const cards = chosenExercises().cards;
  return Object.entries(v.motions).every(([k, e]) => !isProtoName(k) && has(cards, k) && isEntry(e));
}

const shipped = motions as unknown as MotionBundle;

/** The single accept or reject decision for the exercise-motion bundle. */
export const chosenMotions = contentReader('exercise-motion', shipped, isMotionBundle);

/** The motion for an exercise, or undefined when it has none. */
export function getMotion(name: string): MotionEntry | undefined {
  const all = chosenMotions().motions;
  return has(all, name) ? all[name] : undefined;
}

/** "CC-BY-4.0" as "CC BY 4.0". */
export const motionCredit = (e: Pick<MotionEntry, 'author' | 'licence'>): string => `Motion: ${e.author} (${licenceLabel(e.licence)})`;

/** Alt text: "<Name>: looping movement." (or "key position." when the figure is held still), then the first setup step, cut under ALT_MAX characters. */
export function motionAlt(name: string, still: boolean, setup0: string | undefined): string {
  const head = `${name}: ${still ? 'key position.' : 'looping movement.'}`;
  const tail = setup0 ? sentencesWithin(setup0, ALT_MAX - head.length - 1) : null;
  return tail ? `${head} ${tail}` : head;
}
