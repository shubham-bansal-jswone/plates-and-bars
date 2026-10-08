import { loadGolden, prototypeSource, sliceBlock, sliceLine } from './helpers';
import type { ProtoRepl, ProtoRule } from './prototype-exclusions';

/** A day as the prototype stores it (`day-<date>`): only what coverage reads. */
export interface ProtoDayDoc {
  meals: unknown[];
  workout: { exercises: { name: string; sets: { done: boolean }[]; ramp?: { done: boolean }[] | null }[] };
}

export interface ProtoCoverageState {
  date: string;
  settings: {
    excl: ProtoRule[];
    repl: Record<string, ProtoRepl>;
    profile?: Record<string, unknown> | null;
    adj?: Record<string, unknown>;
    focus?: string[];
  };
  lifts: Record<string, unknown>;
  day: ProtoDayDoc;
  /** What the stubbed `Store.get('day-' + date)` returns. */
  store: Record<string, ProtoDayDoc>;
  dayCache?: Record<string, unknown>;
}

export interface ProtoCoverage {
  S: ProtoCoverageState;
  weeklyCoverage(): Record<string, number>;
  coverageHtml(): string;
  actualCoverage(): Promise<Record<string, number>>;
  /** Runs `fillActualCoverage()` and returns the HTML it wrote into `#covActual`. */
  fillActualCoverage(): Promise<string>;
  focusHtml(): string;
  /** Runs `focusAction('focus', chip)` for muscle `m`; returns the toasts it raised and whether it saved. */
  focusAction(m: string): { toasts: string[]; saved: boolean };
  MUSCLE: Record<string, string>;
  COVER_SHOW: string[];
}

/**
 * Runs the prototype's coverage and focus-picker functions, sliced out of the HTML, against a fake `S`,
 * with `TAGS` and `AWAY` from golden/exercises.json as the prototype holds them. The plan engine,
 * `mapForWhere`, `resolveSession` and its rules, `loadDays` and `normDay` are the prototype's own;
 * `Store.get`, `$`, `whyLink`, `toast`, `saveSoon` and `render` are stubbed.
 */
export function loadCoverage(): ProtoCoverage {
  const g = loadGolden<{ tags: Record<string, unknown>; awayMap_dumbbells_bodyweight: Record<string, unknown> }>('exercises');
  const src = prototypeSource();
  const code = [
    'const S = { date:"", settings:{ excl:[], repl:{} }, lifts:{}, day:null, store:{} };',
    'let TOASTS = [], SAVED = false; const EL = { innerHTML:"" };',
    'const Store = { get: k => Promise.resolve(S.store[k.slice(4)] ? JSON.parse(JSON.stringify(S.store[k.slice(4)])) : undefined) };',
    'const $ = () => EL, whyLink = () => "", toast = m => TOASTS.push(m), saveSoon = () => { SAVED = true; }, render = () => {};',
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const mondayOf = '),
    sliceLine(src, 'const MUSCLE = '),
    sliceLine(src, 'const JOINT = '),
    sliceLine(src, 'const ruleState = '),
    sliceBlock(src, 'function ruleMatches(r, name){', '}'),
    sliceLine(src, 'const activeRules = '),
    sliceLine(src, 'const isExcluded = '),
    sliceLine(src, 'const listJoin = '),
    sliceBlock(src, 'function candidates(name, o = {}){', '}'),
    sliceBlock(src, 'function homeName(n, where){', '}'),
    sliceLine(src, 'const SCOPE_RANK = '),
    sliceBlock(src, 'function resolveName(name, where, depth = 0, taken){', '}'),
    sliceBlock(src, 'function resolveSession(names, where, lost){', '}'),
    sliceBlock(src, 'function mapForWhere(names, where){', '}'),
    sliceBlock(src, 'const TEMPLATES = {', '};'),
    sliceLine(src, 'const ORDER = '),
    sliceBlock(src, 'Object.assign(TEMPLATES, {', '});'),
    sliceBlock(src, 'const SPLITS = {', '};'),
    sliceBlock(src, 'function splitFor(){', '}'),
    sliceLine(src, 'const planList = '),
    sliceLine(src, 'const adjState = '),
    sliceLine(src, 'const homeWhere = '),
    sliceLine(src, 'const sessionItems = '),
    sliceBlock(src, 'function weeklyCoverage(){', '}'),
    sliceLine(src, 'const COVER_SHOW = '),
    sliceBlock(src, 'function coverageHtml(){', '}'),
    sliceLine(src, 'const blankDay = '),
    sliceLine(src, 'function normDay(d){'),
    sliceBlock(src, 'async function loadDays(end, n){', '}'),
    sliceBlock(src, 'async function actualCoverage(){', '}'),
    sliceBlock(src, 'async function fillActualCoverage(){', '}'),
    sliceLine(src, 'const focusList = '),
    sliceBlock(src, 'function focusHtml(){', '}'),
    sliceBlock(src, 'function focusAction(a, b){', '}'),
    'return { S, weeklyCoverage, coverageHtml, actualCoverage, focusHtml, MUSCLE, COVER_SHOW,',
    '  fillActualCoverage: async () => { EL.innerHTML = ""; await fillActualCoverage(); return EL.innerHTML; },',
    '  focusAction: m => { TOASTS = []; SAVED = false; focusAction("focus", { dataset:{ v:m } }); return { toasts: TOASTS, saved: SAVED }; } };',
  ].join('\n');
  return new Function('TAGS', 'AWAY', code)(g.tags, g.awayMap_dumbbells_bodyweight) as ProtoCoverage;
}
