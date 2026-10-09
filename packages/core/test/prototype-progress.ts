import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** Prototype day doc as `loadDays` returns it (only the fields these functions read). */
export interface ProtoDay {
  meals: unknown[];
  workout: { exercises: { sets: { done?: boolean; t?: number }[] }[]; cardio?: unknown };
  steps?: unknown;
}

export interface ProtoProgress {
  S: {
    date: string;
    day: ProtoDay;
    settings: { profile: Record<string, unknown> | null };
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
}

/**
 * Runs the prototype's progress functions, sliced out of the HTML, against a fake `S`. `loadDays` is
 * the prototype's own, reading `stored` through a stubbed `Store.get`; `planned` is stubbed; UI calls
 * are no-ops.
 */
export function loadProgress(): ProtoProgress {
  const src = prototypeSource();
  const code = [
    "const S = { date:'', day:null, settings:{ profile:null }, weights:{ entries:{} }, measures:{ entries:{} }, tab:'progress' };",
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
    sliceLine(src, 'function heightText(cm){'),
    sliceBlock(src, 'function setupSummaryHtml(){', '}'),
    sliceLine(src, 'const SU = '),
    sliceBlock(src, 'function startSetup(stepTo){', '}'),
    'const render = () => {}, scrollTo = () => {};',
    'return { S, SU, stored, setPlanned, latestWeight, measureAt, navyBF, waterTarget, workoutBurn, stepsTarget, setupSummaryHtml, startSetup };',
  ].join('\n');
  return new Function(code)() as ProtoProgress;
}
