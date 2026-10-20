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
  /** The Wikimedia Commons page of a cc_licensed clip; null for own filming. */
  source_url: string | null;
  /** When a cc_licensed clip was retrieved (YYYY-MM-DD); null for own filming. */
  retrieved: string | null;
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
/** A cc_licensed clip must come from Wikimedia Commons (tools/validate/exercise-motion.mjs SOURCE_HOSTS). */
export const SOURCE_HOSTS = ['commons.wikimedia.org', 'upload.wikimedia.org'];
// The tools validator accepts a URL only when `new URL(u).href === u`. Hermes' URL class is not a full WHATWG parser, so this is the same
// rule as a pattern: https, an exact host, no user name or port, a path, and only characters the parser leaves as written (an apostrophe is
// kept in a path and fragment but encoded in a query), with no dot segments. It is stricter than the tools validator on a few rare characters (^ ` { } and backslash in a query or fragment, a second # or ?); a test compares the two on a list of URLs, and the tools validator stays the gate that content passes first.
const PLAIN = "A-Za-z0-9._~!$&()*+,;=:@%/|\\[\\]\\-";
const SOURCE_URL = new RegExp(
  `^https://(?:${SOURCE_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})(/[${PLAIN}']*)(?:\\?[${PLAIN}?]*)?(?:#[${PLAIN}'?]*)?$`,
);
const DOT_SEGMENT = /(^|\/)(\.|%2e)(\.|%2e)?(\/|$)/i;
/** True for an https URL on an allowed host in canonical form, as `checkSourceUrl` in tools/validate/exercise-motion.mjs. */
export function isSourceUrl(v: unknown): v is string {
  if (!isStr(v) || v.length > 2000) return false;
  const m = SOURCE_URL.exec(v);
  return m !== null && !DOT_SEGMENT.test(m[1]!);
}
/** A real calendar date as YYYY-MM-DD, not in the future. */
export function isPastDate(v: unknown, today: string = new Date().toISOString().slice(0, 10)): v is string {
  if (!isStr(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v <= today;
}
const isHttps = (v: unknown): boolean => isStr(v) && v.length <= 2000 && /^https:\/\/[^\s]+$/.test(v);
const nonBlank = (v: unknown): v is string => isStr(v) && !isBlank(v);
const isFrame = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === FRAME_LENGTH && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_COORD);

/** cc_licensed: a Commons source_url and a retrieved date; own_filming: both null. */
const sourceFieldsOk = (v: Record<string, unknown>): boolean =>
  v.source === 'cc_licensed' ? isSourceUrl(v.source_url) && isPastDate(v.retrieved) : v.source_url === null && v.retrieved === null;

const isEntry = (v: unknown): v is MotionEntry =>
  isObj(v) && Number.isInteger(v.fps) && (v.fps as number) >= MIN_FPS && (v.fps as number) <= MAX_FPS && typeof v.loop === 'boolean' &&
  Array.isArray(v.frames) && v.frames.length >= MIN_FRAMES && isArrOf(v.frames, isFrame) &&
  isStr(v.source) && SOURCES.includes(v.source) && isStr(v.licence) && has(LICENCES, v.licence) && v.licence_url === LICENCES[v.licence] &&
  sourceFieldsOk(v) && nonBlank(v.author) && (v.author_url === null || isHttps(v.author_url)) && (v.note === null || nonBlank(v.note));

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

/** About's "Motion" credits: every shipped entry under its exercise name, in name order. */
export function getMotionCredits(): readonly { name: string; entry: MotionEntry }[] {
  return Object.entries(chosenMotions().motions).sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => ({ name, entry }));
}

/** "CC-BY-4.0" as "CC BY 4.0". */
export const motionCredit = (e: Pick<MotionEntry, 'author' | 'licence'>): string => `Motion: ${e.author} (${licenceLabel(e.licence)})`;

/** Alt text: "<Name>: looping movement." (or "key position." when the figure is held still), then the first setup step, cut under ALT_MAX characters. */
export function motionAlt(name: string, still: boolean, setup0: string | undefined): string {
  const head = `${name}: ${still ? 'key position.' : 'looping movement.'}`;
  const tail = setup0 ? sentencesWithin(setup0, ALT_MAX - head.length - 1) : null;
  return tail ? `${head} ${tail}` : head;
}
