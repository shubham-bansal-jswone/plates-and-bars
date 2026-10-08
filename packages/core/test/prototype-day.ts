import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoModsResult {
  light: unknown;
  template: string;
  base: string;
  mods: { light: unknown; short: unknown; where: unknown; deload: unknown; reentry: unknown };
}

export interface ProtoDay {
  S: { date: string; settings: Record<string, unknown>; day: { workout: Record<string, unknown> } };
  /** The mods steps of `buildSession(t)` run against `S`; returns the local `light` and what it stores. */
  mods(t: string): ProtoModsResult;
  /** The `vol` sum of `renderWorkout()` over `S.day.workout`. */
  volume(): number;
  secondSessionHtml(): string;
  modsNote(m: unknown): string;
  /** `addSecondSession(t)` with `buildSession(t)` stubbed to set the workout's exercises and mods to `built`. */
  addSecondSession(t: string, built: { exercises: unknown[]; mods: unknown }): void;
}

/** The lines of `block` starting with each prefix, in order; throws if one is missing (prototype reshaped). */
function pick(block: string, prefixes: string[]): string {
  const lines = block.split('\n');
  return prefixes
    .map((p) => {
      const l = lines.find((x) => x.startsWith(p));
      if (l === undefined) throw new Error(`prototype: no line starting with ${p}`);
      return l;
    })
    .join('\n');
}

/**
 * Runs the prototype's session-mods, template-name, mods-note, volume and second-session rules, sliced out of the
 * HTML, against a fake `S`. `labHoldOn`, `needsClearance`, `screenFlag`, `inRange`, `adjState`,
 * `planList` and `num` are the prototype's own; `whereNow` reads `S.day.workout.where`, and UI calls
 * (`esc`, `saveDay`, `render`, `toast`) are stubbed.
 */
export function loadDay(): ProtoDay {
  const src = prototypeSource();
  const build = sliceBlock(src, 'function buildSession(t){', '}');
  const render = sliceBlock(src, 'function renderWorkout(){', '}');
  const code = [
    'const S = { date:"", settings:{}, day:{ workout:{} } };',
    'let BUILT = null;',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const adjState = '),
    sliceLine(src, 'const inRange = '),
    sliceLine(src, 'const labHoldOn = '),
    sliceLine(src, 'const screenFlag = '),
    sliceLine(src, 'const needsClearance = '),
    sliceLine(src, 'const ORDER = '),
    sliceBlock(src, 'const SPLITS = {', '};'),
    sliceBlock(src, 'function splitFor(){', '}'),
    sliceLine(src, 'const planList = '),
    'const whereNow = () => S.day.workout.where;',
    'function mods(t){',
    '  const w = S.day.workout, A = adjState(), where = whereNow(), ci = w.checkin || {};',
    pick(build, ['  const short = ', '  const deload = ', '  const light = ', '  w.base = t; w.template = ', '  w.mods = ']),
    '  return { light, template: w.template, base: w.base, mods: w.mods };',
    '}',
    'function volume(){',
    '  const w = S.day.workout;',
    pick(render, ['    let done = 0, all = 0, vol = 0;', '    w.exercises.forEach(ex => ex.sets.forEach(s => { all++;']),
    '  return vol;',
    '}',
    sliceBlock(src, 'function secondSessionHtml(){', '}'),
    sliceBlock(src, 'function modsNote(m){', '}'),
    'function buildSession(t){ const b = JSON.parse(JSON.stringify(BUILT)); S.day.workout.exercises = b.exercises; S.day.workout.mods = b.mods; }',
    'const saveDay = () => {}, render = () => {}, toast = () => {};',
    sliceBlock(src, 'function addSecondSession(t){', '}'),
    'return { S, mods, volume, secondSessionHtml, modsNote, addSecondSession: (t, built) => { BUILT = built; addSecondSession(t); } };',
  ].join('\n');
  return new Function(code)() as ProtoDay;
}
