import type { ExerciseCatalog, ExerciseTag } from '../src/index';
import { loadGolden, prototypeSource, sliceBlock, sliceLine } from './helpers';

/** A tag as the prototype and golden/exercises.json write it (prototype `TG`). */
export interface ShortTag {
  p: string;
  f: string;
  eq: string;
  d: number;
  m: string[];
  s: string[];
  j: string[];
}

interface GoldenExercises {
  tags: Record<string, ShortTag>;
  cards: Record<string, unknown>;
  awayMap_dumbbells_bodyweight: Record<string, [string | null, string | null]>;
}

/** golden/exercises.json as the prototype holds it (short tag names, flat away map). */
function goldenExercises(): GoldenExercises {
  return loadGolden<GoldenExercises>('exercises');
}

/**
 * The only place the prototype's short tag names map to content's names. Key order follows
 * content/exercises.json (and tools/exercises-import), so tag objects compare equal key by key.
 */
function longTag(t: ShortTag): ExerciseTag {
  return { pattern: t.p, family: t.f, equipment: t.eq, difficulty: t.d, primary: t.m, secondary: t.s, joints: t.j };
}

/** Prototype `EX_META` as golden/progression.json's `exerciseMeta` holds it (`name → [type, lo, hi]`). */
export type MetaTable = Record<string, [string, number, number]>;

/**
 * The exercise content from golden/exercises.json (and `exerciseMeta` from golden/progression.json),
 * renamed to the content/exercises.json shape the port takes.
 */
export function goldenCatalog(): ExerciseCatalog {
  const g = goldenExercises();
  const tags = Object.fromEntries(Object.entries(g.tags).map(([n, t]) => [n, longTag(t)]));
  const metaTable = loadGolden<{ exerciseMeta: MetaTable }>('progression').exerciseMeta;
  const meta = Object.fromEntries(Object.entries(metaTable).map(([n, [type, rep_low, rep_high]]) => [n, { type, rep_low, rep_high }]));
  return { tags, meta, cards: g.cards, away_map: { dumbbells_bodyweight: g.awayMap_dumbbells_bodyweight } };
}

/** The other way: a catalogue's meta as prototype `EX_META`, for the sliced prototype functions. */
export function metaTable(meta: ExerciseCatalog['meta']): MetaTable {
  return Object.fromEntries(Object.entries(meta).map(([n, m]) => [n, [m.type, m.rep_low, m.rep_high]]));
}

/** A content-named tag in the prototype's short names (for the sliced prototype functions). */
export function shortTag(t: ExerciseTag): ShortTag {
  return { p: t.pattern, f: t.family, eq: t.equipment, d: t.difficulty, m: [...t.primary], s: [...t.secondary], j: [...t.joints] };
}

/** Prototype state the sliced functions read, plus test-only hooks for the stubs. */
export interface ProtoState {
  date: string;
  settings: Record<string, unknown>;
  sessions: { entries: Record<string, unknown> };
  lifts: Record<string, unknown>;
  day: { workout: Record<string, unknown> };
  /** Stub for `lastFor(name).sets.length`. */
  last: Record<string, number>;
  /** Stub for `needsClearance()`. */
  clearance: boolean;
}

export interface Proto {
  S: ProtoState;
  planned(date: string): string | null;
  mapForWhere(names: string[], where: string): string[];
  resolveSession(names: string[], where: string): { name: string; bridge?: boolean }[];
  trimSession(items: unknown[], t: string): { name: string; bridge?: boolean }[];
  applyFocus(items: unknown[], t: string, where: string): { name: string; bridge?: boolean; focus?: boolean }[];
  setsFor(name: string, base: number): number;
  buildSession(t: string): void;
  TEMPLATES: Record<string, string[]>;
  SPLITS: Record<string, { list: string[]; days: number[] }>;
}

/**
 * Runs the prototype's own plan-engine functions, sliced out of the HTML, against a fresh fake `S`,
 * with `TAGS`, `CARDS` and `AWAY` from golden/exercises.json as the prototype holds them.
 * Exclusions are stubbed (`isExcluded` reads `S.settings.excl`, a list of names; no rules), as are
 * `lastFor`, `needsClearance`, `labHoldOn` (off) and `whereNow`.
 */
export function loadProto(): Proto {
  const g = goldenExercises();
  const src = prototypeSource();
  const code = [
    'const S = { date:"", settings:{}, sessions:{ entries:{} }, lifts:{}, day:{ workout:{} }, last:{}, clearance:false };',
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceBlock(src, 'const TEMPLATES = {', '};'),
    sliceLine(src, 'const ORDER = '),
    sliceBlock(src, 'Object.assign(TEMPLATES, {', '});'),
    sliceLine(src, 'const adjState = '),
    sliceLine(src, 'const mondayOf = '),
    sliceLine(src, 'const daysBetween = '),
    sliceLine(src, 'const sessionDates = '),
    sliceLine(src, 'function lastSession(before){'),
    sliceLine(src, 'const inRange = '),
    sliceBlock(src, 'function planned(date){', '}'),
    sliceBlock(src, 'const SPLITS = {', '};'),
    sliceBlock(src, 'function splitFor(){', '}'),
    sliceLine(src, 'const planList = '),
    sliceBlock(src, 'function dayTemplate(date){', '}'),
    sliceLine(src, 'function exerciseCap(){'),
    sliceBlock(src, 'function setsFor(name, base){', '}'),
    sliceLine(src, 'const COMPOUND = '),
    sliceBlock(src, 'function trimSession(items, t){', '}'),
    sliceLine(src, 'const older = '),
    sliceLine(src, 'const PUSH_M = '),
    sliceBlock(src, 'function muscleAllowed(t, m){', '}'),
    sliceLine(src, 'const focusList = '),
    sliceLine(src, 'const isFocus = '),
    sliceBlock(src, 'function focusPick(m, taken, where){', '}'),
    sliceBlock(src, 'function applyFocus(items, t, where){', '}'),
    sliceBlock(src, 'function mapForWhere(names, where){', '}'),
    sliceBlock(src, 'function homeName(n, where){', '}'),
    sliceLine(src, 'const SCOPE_RANK = '),
    sliceBlock(src, 'function resolveName(name, where, depth = 0, taken){', '}'),
    sliceBlock(src, 'function resolveSession(names, where, lost){', '}'),
    sliceBlock(src, 'function newExercise(name){', '}'),
    sliceBlock(src, 'function buildSession(t){', '}'),
    // stubs for what the slices call outside the plan engine
    'const ruleState = () => { const X = S.settings; X.excl = X.excl || []; X.repl = X.repl || {}; return X; };',
    'const isExcluded = n => (S.settings.excl || []).includes(n);',
    'const activeRules = () => [], ruleMatches = () => false, candidates = () => [];',
    'const lastFor = n => S.last[n] === undefined ? null : { sets: Array.from({ length: S.last[n] }) };',
    'const needsClearance = () => S.clearance, labHoldOn = () => false;',
    'const whereNow = () => S.day.workout.where || (S.settings.profile && S.settings.profile.where) || "gym";',
    'return { S, planned, mapForWhere, resolveSession, trimSession, applyFocus, setsFor, buildSession, TEMPLATES, SPLITS };',
  ].join('\n');
  return new Function('TAGS', 'CARDS', 'AWAY', code)(g.tags, g.cards, g.awayMap_dumbbells_bodyweight) as Proto;
}

/** Small seeded PRNG (mulberry32) so the differential grids are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
