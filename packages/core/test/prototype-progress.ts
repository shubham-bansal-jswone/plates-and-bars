import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** Prototype day doc as `loadDays` returns it (only the fields these functions read). */
export interface ProtoDay {
  meals: { name: string; qty: number; kcal: number; p: number; c: number; f: number }[];
  workout: { exercises: { sets: { done?: boolean; t?: number }[] }[]; cardio?: unknown };
  steps?: unknown;
  sleep?: unknown;
  complete?: boolean;
}

export interface ProtoProgress {
  S: {
    date: string;
    day: ProtoDay;
    settings: { profile: Record<string, unknown> | null; kcal?: number; protein?: number; carbs?: number; adj?: Record<string, unknown>; adaptive?: Record<string, unknown> };
    lifts: Record<string, { date: string; hist?: { date: string; e: number }[] }>;
    sessions: { entries: Record<string, { t?: string; n?: number }> };
    ciData?: Record<string, unknown>;
    weights: { entries: Record<string, number> };
    measures: { entries: Record<string, Record<string, number>> };
    tab: string;
  };
  SU: { p: Record<string, unknown> };
  /** Day docs `Store.get('day-<date>')` returns; dates not here load as a blank day. */
  stored: Record<string, ProtoDay>;
  /** What the stubbed `planned(date)` returns. */
  setPlanned(t: string | null): void;
  latestWeight(upTo?: string): number | null;
  measureAt(key: string, upTo: string): { date: string; v: number } | null;
  navyBF(upTo: string): number | null;
  waterTarget(): { ml: number; trained: boolean };
  workoutBurn(w: ProtoDay['workout'], kg: number): { sets: number; min: number; cardio: number; gross: number; extra: number; timed: boolean };
  stepsTarget(): Promise<number>;
  setupSummaryHtml(): string;
  startSetup(): void;
  /** What the stubbed `TODAY()` returns. */
  setToday(d: string): void;
  weeklyAvg(end: string): number | null;
  calorieCard(): string;
  /** The `adj-kcal` step of `adjAction` with button value `v`. */
  adjKcal(v: string): void;
  weightSlope(end: string, span: number): { n: number; slope?: number };
  adaptiveBurn(days: { date: string; day: ProtoDay }[]): Record<string, unknown>;
  targetFromBurn(burn: number): { kcal: number; protein: number; fat: number; carbs: number } | null;
  loadDays(end: string, n: number): Promise<{ date: string; day: ProtoDay }[]>;
  /** Runs `renderCheckin()` and returns the check-in element's HTML. */
  renderCheckin(): Promise<string>;
  consistencyHtml(): Promise<string>;
}

/** Lines from the first equal to `start` (after trimming) for `n` lines. */
function sliceTrimmed(src: string, start: string, n = 1): string {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l.trim().startsWith(start));
  if (from < 0) throw new Error(`prototype: no line starting with ${start}`);
  return lines.slice(from, from + n).join('\n');
}

/**
 * Runs the prototype's progress functions, sliced out of the HTML, against a fake `S`. `loadDays` is
 * the prototype's own, reading `stored` through a stubbed `Store.get`; `planned` is stubbed; UI calls
 * are no-ops.
 */
export function loadProgress(): ProtoProgress {
  const src = prototypeSource();
  const code = [
    "const S = { date:'', day:null, settings:{ profile:null }, weights:{ entries:{} }, measures:{ entries:{} }, tab:'progress', lifts:{}, sessions:{ entries:{} } };",
    'let today = ""; const TODAY = () => today; const setToday = d => { today = d; };',
    'const el = { innerHTML: "" }; const $ = q => (q === "#checkin" ? el : null);',
    'const whyLink = () => "", cycInfo = () => null, sampleFn = null, saveSoon = () => {}, saveSettings = () => {}, toast = () => {};',
    'const stored = {};',
    'let plannedT = null; const planned = () => plannedT; const setPlanned = t => { plannedT = t; };',
    "const Store = { get: k => Promise.resolve(stored[k.slice(4)] ? JSON.parse(JSON.stringify(stored[k.slice(4)])) : null) };",
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const r1 = '),
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const mondayOf = '),
    sliceLine(src, 'const daysBetween = '),
    sliceLine(src, 'const adjState = '),
    sliceBlock(src, 'function adjButtons(', '}'),
    sliceBlock(src, 'function adjCard(', '}'),
    sliceBlock(src, 'function stalled(name){', '}'),
    sliceLine(src, 'const stalledList = '),
    sliceBlock(src, 'function totals(meals = S.day.meals){', '}'),
    sliceBlock(src, 'function dayComplete(d){', '}'),
    sliceLine(src, 'const ORDER = '),
    sliceBlock(src, 'const SPLITS = {', '};'),
    sliceBlock(src, 'function splitFor(){', '}'),
    sliceLine(src, 'const planList = '),
    sliceLine(src, 'const blankDay = '),
    sliceLine(src, 'function normDay(d){'),
    sliceBlock(src, 'const ACTIVITY = {', '};'),
    sliceBlock(src, 'const GOALS = {', '};'),
    sliceLine(src, 'const PACE = '),
    sliceLine(src, 'const TRAIN_NET_MET = '),
    sliceLine(src, 'const bmrOf = '),
    sliceBlock(src, 'function calcTargets(p){', '}'),
    sliceBlock(src, 'function latestWeight(upTo){', '}'),
    sliceBlock(src, 'function measureAt(key, upTo){', '}'),
    sliceBlock(src, 'function navyBF(upTo){', '}'),
    sliceBlock(src, 'function waterTarget(){', '}'),
    sliceBlock(src, 'function workoutBurn(w, kg){', '}'),
    sliceBlock(src, 'async function loadDays(end, n){', '}'),
    sliceBlock(src, 'async function stepsTarget(){', '}'),
    sliceBlock(src, 'function weeklyAvg(end){', '}'),
    sliceBlock(src, 'function calorieCard(){', '}'),
    `function adjKcal(v){ const A = adjState(), b = { dataset:{ v } }, key = ''; const done = () => {}; switch('adj-kcal'){\n${sliceTrimmed(src, "case 'adj-kcal':")}\n} }`,
    sliceLine(src, 'const KCAL_PER_KG = '),
    sliceBlock(src, 'function weightSlope(end, span){', '}'),
    sliceBlock(src, 'function adaptiveBurn(days){', '}'),
    sliceBlock(src, 'function targetFromBurn(burn){', '}'),
    sliceBlock(src, 'async function renderCheckin(){', '}'),
    sliceBlock(src, 'async function consistencyHtml(){', '}'),
    sliceLine(src, 'function heightText(cm){'),
    sliceBlock(src, 'function setupSummaryHtml(){', '}'),
    sliceLine(src, 'const SU = '),
    sliceBlock(src, 'function startSetup(stepTo){', '}'),
    'const render = () => {}, scrollTo = () => {};',
    'const renderCheckinHtml = async () => { el.innerHTML = ""; await renderCheckin(); return el.innerHTML; };',
    'return { S, SU, stored, setPlanned, setToday, latestWeight, measureAt, navyBF, waterTarget, workoutBurn, stepsTarget, setupSummaryHtml, startSetup,',
    '  weeklyAvg, calorieCard, adjKcal, weightSlope, adaptiveBurn, targetFromBurn, loadDays, renderCheckin: renderCheckinHtml, consistencyHtml };',
  ].join('\n');
  return new Function(code)() as ProtoProgress;
}
