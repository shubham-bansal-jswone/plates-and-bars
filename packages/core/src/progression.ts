import { daysBetween } from './dates';
import { num } from './num';
import { older, type PlanProfile, type Where } from './plan';

/** Equipment type of an exercise (prototype `EX_META[name][0]`). */
export type ExType = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'assisted' | 'bodyweight' | 'time' | 'other';

/**
 * Per-exercise type and rep range, as in prototype `EX_META` (`name → [type, lo, hi]`). It is content
 * data, so it is passed in rather than copied here; golden/progression.json's `exerciseMeta` has this shape.
 */
export type ExerciseMetaTable = Readonly<Record<string, readonly [ExType, number, number]>>;

/** Smallest weight jump per type, in kg. Mirrors prototype `DEFAULT_STEP`. */
export const DEFAULT_STEP: Readonly<Record<ExType, number>> = { barbell: 2.5, dumbbell: 2.5, machine: 5, cable: 5, assisted: 5, other: 2.5, bodyweight: 0, time: 0 };

/** Set ratings. Mirrors the keys of prototype `RATES`. */
export type Rate = 'easy' | 'right' | 'hard' | 'fail';
const RATES: Readonly<Record<Rate, string>> = { easy: 'Easy', right: 'Just right', hard: 'Hard', fail: 'Couldn’t finish' };

/** The user's per-exercise settings (prototype `S.settings.ex[name]`). */
export interface ExerciseOverride {
  type?: ExType;
  lo?: number;
  hi?: number;
  step?: number;
}

/** Type, rep range and weight step for an exercise. */
export interface ExInfo {
  type: ExType;
  lo: number;
  hi: number;
  step: number;
}

/** A logged set as stored in the lift record (prototype `updateLift`). */
export interface LiftSet {
  w: number;
  r: number;
  rate?: Rate | null;
}

/** An earlier session in a lift record (prototype `L.prev`). */
export interface LiftSession {
  date: string;
  sets: readonly LiftSet[];
  form?: 'yes' | 'no' | null;
}

/** Last record for an exercise (prototype `S.lifts[name]`); only the fields read here. */
export interface LiftRecord extends LiftSession {
  n?: number;
  /** First date on this exercise; older records may lack it. */
  first?: string;
  prev?: LiftSession | null;
}

/** Everything the weight guidance reads from state. */
export interface ProgressionContext {
  /** Today, `YYYY-MM-DD` (prototype `S.date`). */
  date: string;
  /** Prototype `S.lifts`. */
  lifts: Readonly<Record<string, LiftRecord>>;
  /** Prototype `EX_META`. */
  meta: ExerciseMetaTable;
  /** Prototype `S.settings.ex`. */
  overrides?: Readonly<Record<string, ExerciseOverride>>;
  /** Where today's session happens (prototype `whereNow()`); defaults to the gym. */
  where?: Where;
  /** For the 60+ jump limit (prototype `older()`). */
  profile?: PlanProfile | null;
}

/** A session suggestion. `w` is absent for a first time and `''` for unweighted bodyweight. */
export interface Suggestion {
  mode: 'new' | 'bw-new' | 'bw' | 'down' | 'up' | 'hold';
  reps: number;
  w?: number | '';
  text: string;
  reason: string;
}

/** Mirrors prototype `r1`. Coerces like the prototype (`'2,5'` gives `NaN`). */
const r1 = (n: number | string): number => Math.round(Number(n) * 10) / 10;

/**
 * Type, rep range and step: the user's setting wins, else `meta` (unknown names: other, 8–12). With
 * dumbbells at home the range rises to at least 10–20 unless the user set the low end.
 *
 * Mirrors prototype `exInfo(name)` (`whereNow()` passed in as `where`).
 */
export function exInfo(name: string, meta: ExerciseMetaTable, override?: ExerciseOverride | null, where: Where = 'gym'): ExInfo {
  const m = meta[name] || (['other', 8, 12] as const);
  const o = override || {};
  const type = o.type || m[0];
  const homeDb = type === 'dumbbell' && !o.lo && where === 'dumbbells';
  return { type, lo: o.lo || (homeDb ? Math.max(10, m[1]) : m[1]), hi: o.hi || (homeDb ? Math.max(20, m[2]) : m[2]), step: o.step !== undefined ? o.step : DEFAULT_STEP[type] };
}

/** Mirrors prototype `noLoad(t)`: bodyweight and timed holds have no weight to suggest. */
export const noLoad = (t: ExType): boolean => t === 'bodyweight' || t === 'time';
/** Mirrors prototype `repWord(t)`. */
export const repWord = (t: ExType): string => (t === 'time' ? 'sec' : 'reps');

/** Rounds to the nearest step (no rounding for step 0). Mirrors prototype `snap(x, step)`. */
export function snap(x: number, step: number): number {
  return step > 0 ? Math.round(x / step) * step : x;
}

/** One step harder: +1 step, or 1 step less assistance (not below 0). Mirrors prototype `harder(w, info)`. */
export function harder(w: number, info: ExInfo): number {
  return info.type === 'assisted' ? Math.max(0, w - info.step) : w + info.step;
}

/** Drop about `pct`, at least one step (assisted: more assistance). Mirrors prototype `easier(w, info, pct)`. */
export function easier(w: number, info: ExInfo, pct: number): number {
  if (info.type === 'assisted') return w + Math.max(info.step, snap(w * pct, info.step));
  const d = Math.max(info.step, snap(w * pct, info.step || 1));
  return Math.max(0, w - d);
}

/** Mirrors prototype `kgLabel(w, info)`. */
export function kgLabel(w: number, info: ExInfo): string {
  return info.type === 'assisted' ? `${r1(w)} kg assist` : info.type === 'dumbbell' ? `${r1(w)} kg each` : `${r1(w)} kg`;
}

function kgLabelShort(w: number, info: ExInfo): string {
  return noLoad(info.type) ? (w ? `+${r1(w)} kg, ` : '') : `${r1(w)} kg${info.type === 'dumbbell' ? ' each' : info.type === 'assisted' ? ' assist' : ''}, `;
}

/** The last session before today: the record, else its `prev`, else none. Mirrors prototype `lastFor(name)`. */
export function lastFor(name: string, lifts: ProgressionContext['lifts'], date: string): LiftSession | null {
  const L = lifts[name];
  if (!L) return null;
  if (L.date < date) return L;
  if (L.prev && L.prev.date < date) return L.prev;
  return null;
}

/** Heaviest set weight (assisted: least assistance). */
function topOf(sets: readonly LiftSet[], info: ExInfo): number {
  return sets.reduce((m, s) => (info.type === 'assisted' ? Math.min(m, s.w) : Math.max(m, s.w)), (sets[0] as LiftSet).w);
}

const infoFor = (name: string, c: ProgressionContext): ExInfo => exInfo(name, c.meta, (c.overrides || {})[name], c.where);

/**
 * Double progression with safety rules, from the last session. Top of the range on every set with
 * no Hard or Couldn't finish: +1 step (assisted: 1 step less assistance), unless form slipped or it
 * is the first 14 days on the exercise (all sets Easy skips that hold). Below the range with a
 * failed set or two sessions running: drop ~7.5% (at least 1 step). Otherwise same weight, +1 rep.
 * Bodyweight and timed exercises aim for one more rep.
 *
 * Mirrors prototype `suggestBase(ex)` (state passed in).
 */
export function suggestBase(ex: { name: string }, c: ProgressionContext): Suggestion {
  const info = infoFor(ex.name, c);
  const last = lastFor(ex.name, c.lifts, c.date);
  const rw = repWord(info.type);
  const range = `${info.lo}–${info.hi} ${rw}`;
  if (!last) return { mode: noLoad(info.type) ? 'bw-new' : 'new', reps: info.lo, text: range, reason: noLoad(info.type) ? `Aim for ${range} with clean form.` : '' };
  const sets = last.sets;
  const top = topOf(sets, info);
  const work = sets.filter((s) => s.w === top);
  const avg = work.reduce((n, s) => n + s.r, 0) / work.length;
  const rates = sets.map((s) => s.rate).filter((r): r is Rate => !!r);
  const anyFail = rates.includes('fail');
  const anyHard = rates.includes('hard');
  const allEasy = rates.length === sets.length && rates.every((r) => r === 'easy');
  const allTop = work.every((s) => s.r >= info.hi);
  const L = c.lifts[ex.name];
  const first = L && L.first; // older records without a start date skip the 2-week cap
  const early = first ? daysBetween(first, c.date) < 14 : false;
  const lastRate = rates[rates.length - 1];
  const summary = `Last time: ${work.length} × ${kgLabelShort(top, info)}${work.map((s) => s.r).join(', ')} ${rw}${lastRate ? `, rated ${RATES[lastRate].toLowerCase()}` : ''}.`;

  if (noLoad(info.type)) {
    if (allTop) return { mode: 'bw', reps: info.hi, w: top || '', text: `${info.hi}+ ${rw}`, reason: `${summary} You’re at the top of the range. Keep going, or add a little weight or a harder version.` };
    const target = Math.min(info.hi, Math.round(avg) + 1);
    return { mode: 'bw', reps: target, w: top || '', text: `${target} ${rw} a set`, reason: `${summary} Aim for one more rep per set.` };
  }
  // Prototype prevOf(name, last): the record's prev, only when last is the record itself.
  const prev = L && last === L ? L.prev : null;
  const prevAvgLow = !!prev && !!prev.sets.length && prev.sets.reduce((n, s) => n + s.r, 0) / prev.sets.length < info.lo;
  if (avg < info.lo && (prevAvgLow || anyFail)) {
    const nw = easier(top, info, 0.075);
    return { mode: 'down', w: nw, reps: info.lo, text: `${kgLabel(nw, info)} × ${range}`, reason: `${summary} Below ${info.lo} ${rw} ${anyFail ? 'with a failed set' : 'two sessions running'}, so drop a little and build back up.` };
  }
  if (allTop && !anyFail && !anyHard) {
    if (last.form === 'no') return { mode: 'hold', w: top, reps: info.hi, text: `${kgLabel(top, info)} × ${range}`, reason: `${summary} You hit the top of the range, but form slipped, so stay here until it feels solid.` };
    if (early && !allEasy) return { mode: 'hold', w: top, reps: info.hi, text: `${kgLabel(top, info)} × ${range}`, reason: `${summary} First 2 weeks on this exercise: keep the weight and own the movement before adding more.` };
    const nw = harder(top, info);
    const jump = top > 0 ? Math.abs(nw - top) / top : 0;
    const big = jump > (older(c.profile) ? 0.05 : 0.1) ? ` That’s a ${Math.round(jump * 100)}% jump. If you can’t reach ${info.lo} ${rw}, go back to ${r1(top)} kg and add reps instead.` : '';
    return { mode: 'up', w: nw, reps: info.lo, text: `${kgLabel(nw, info)} × ${range}`, reason: `${summary} Top of the range on every set, so ${info.type === 'assisted' ? 'use less assistance' : `add ${r1(info.step)} kg`} and aim for ${info.lo}+ ${rw}.${big}` };
  }
  const target = Math.min(info.hi, Math.max(info.lo, Math.round(avg) + 1));
  return { mode: 'hold', w: top, reps: target, text: `${kgLabel(top, info)} × ${target} ${rw}`, reason: `${summary} ${avg < info.lo ? `Stay at this weight and work up to ${info.lo}+ ${rw}.` : `Same weight, aim for ${target} ${rw} a set. Add weight once you reach ${info.hi} on every set.`}` };
}

/** Today's session modifiers (prototype `S.day.workout.mods`); only these fields are read. */
export interface WorkoutMods {
  light?: boolean;
  deload?: boolean;
  /** Re-entry fraction (0.15 or 0.3), 0 when off. */
  reentry?: number;
}

/** What `applyMods` reads besides the progression context. */
export interface ModsContext extends ProgressionContext {
  mods?: WorkoutMods | null;
  /** Exercises coming back after an exclusion (prototype `S.settings.returning`). */
  returning?: Readonly<Record<string, { until: string }>>;
}

/**
 * Adjusts a suggestion for today's modifiers. Returning after an exclusion (until its date): 55% of
 * the old top; bridge exercise: 85%. A light, deload or re-entry day turns an increase into the old
 * top. Then deload takes 10% off, re-entry its own fraction. Bodyweight, first-time and weightless
 * suggestions pass through.
 *
 * Mirrors prototype `applyMods(sug, ex)` (state passed in). `suggestFor(ex)` is
 * `applyMods(suggestBase(ex, c), ex, c)`.
 */
export function applyMods(sug: Suggestion, ex: { name: string; bridge?: boolean }, c: ModsContext): Suggestion {
  const m = c.mods || {};
  if (sug.w === undefined || sug.w === '') return sug;
  const info = infoFor(ex.name, c);
  if (noLoad(info.type)) return sug;
  const last = lastFor(ex.name, c.lifts, c.date);
  if (!last) return sug;
  const top = topOf(last.sets, info);
  let w = sug.w;
  let note = '';
  const ret = (c.returning || {})[ex.name];
  if (ret && ret.until >= c.date) {
    w = info.type === 'assisted' ? w + snap(w * 0.45, info.step || 1) : Math.max(0, snap(top * 0.55, info.step || 1));
    note = ' Coming back to this exercise: about 55% of your old weight for 2 weeks.';
  } else if (ex.bridge) {
    w = info.type === 'assisted' ? w : Math.max(0, snap(top * 0.85, info.step || 1));
    note = ' Bridge set: lighter, after your new exercise.';
  }
  if ((m.light || m.deload || m.reentry) && sug.mode === 'up' && !note) {
    w = top;
    note = ' No weight increase today.';
  }
  const pct = m.deload ? 0.1 : m.reentry || 0;
  if (pct) {
    w = info.type === 'assisted' ? w + Math.max(info.step, snap(w * pct, info.step)) : Math.max(0, snap(w * (1 - pct), info.step || 1));
    note = m.deload ? ' Recovery week: about 10% lighter.' : ` Easing back in: about ${Math.round(pct * 100)}% lighter.`;
  }
  if (w === sug.w && !note) return sug;
  return { ...sug, w, mode: 'hold', text: `${kgLabel(w, info)} × ${info.lo}–${info.hi} ${repWord(info.type)}`, reason: sug.reason + note };
}

/** A set row in today's session or ramp, as typed (strings) plus its tick and rating. */
export interface SetEntry {
  w: string;
  r: string;
  done: boolean;
  rate?: Rate | null;
}

/** Placeholder weight and reps for a set: numbers, or the typed text, or `''` for none. */
export interface SetTarget {
  w: number | string;
  r: number | string;
}

/**
 * Placeholder for working set `j`. After a ticked loaded set: Easy → +1 step at the suggested reps;
 * Couldn't finish → ~10% lighter, reps at least the range bottom; Hard → same weight and reps; else
 * same weight at the suggested reps. Otherwise the ramp's found weight, else the suggestion.
 *
 * Mirrors prototype `setTarget(ex, j, sug)` (`ex.sets`, `ex.found` and `exInfo` passed in).
 */
export function setTarget(sets: readonly SetEntry[], j: number, sug: Suggestion, info: ExInfo, found?: number | null): SetTarget {
  const p = sets[j - 1];
  if (p && p.done && p.w !== '' && !noLoad(info.type)) {
    const w = num(p.w);
    if (p.rate === 'easy') return { w: harder(w, info), r: sug.reps };
    if (p.rate === 'fail') return { w: easier(w, info, 0.1), r: Math.max(info.lo, num(p.r)) };
    return { w, r: p.rate === 'hard' ? num(p.r) : sug.reps || num(p.r) };
  }
  if (p && p.done && noLoad(info.type)) return { w: p.w, r: num(p.r) || sug.reps };
  if (found !== undefined && found !== null) return { w: found, r: info.lo };
  if (sug.w !== undefined && sug.w !== '') return { w: sug.w, r: sug.reps };
  return { w: '', r: sug.reps || '' };
}

/**
 * Ticking a working set: empty fields take the placeholder (weight rounded to 0.1). `ok` is false
 * when the prototype refuses the tick ("Enter the weight and reps first").
 *
 * Mirrors the fill-and-check step of prototype `workoutAction('tick')`.
 */
export function tickFill(set: Pick<SetEntry, 'w' | 'r'>, target: SetTarget, info: ExInfo): { w: string; r: string; ok: boolean } {
  let { w, r } = set;
  if (w === '' && target.w !== '') w = String(r1(target.w));
  if (r === '' && target.r) r = String(target.r);
  return { w, r, ok: !(r === '' || (w === '' && !noLoad(info.type))) };
}

/**
 * Rating ramp set `j` (or clearing it with `null`). Just right → that weight; Hard → one step
 * lighter; Couldn't finish → the previous ticked ramp weight, else ~10% lighter; Easy → no weight
 * yet, and a new ramp set is added when `j` is the last one.
 *
 * Mirrors the ramp branch of prototype `workoutAction('rate' | 'rerate')`.
 */
export function rampRate(ramp: readonly SetEntry[], j: number, rate: Rate | null, info: ExInfo): { found: number | null; addSet: boolean } {
  if (!rate) return { found: null, addSet: false };
  const wv = num((ramp[j] as SetEntry).w);
  const prior = ramp.slice(0, j).reverse().find((x) => x.done);
  let found: number | null = null;
  if (rate === 'right') found = wv;
  else if (rate === 'hard') found = Math.max(0, easier(wv, info, 0));
  else if (rate === 'fail') found = prior ? num(prior.w) : Math.max(0, easier(wv, info, 0.1));
  return { found, addSet: rate === 'easy' && ramp.length <= j + 1 };
}

/**
 * Ticking ramp set `j`: an empty weight after an Easy ramp set takes +1 step (rounded to 0.1); empty
 * reps take the range bottom + 2 on the first ramp set, the bottom after. `ok` is false when the
 * weight is still empty ("Enter the weight first"). The same weight is the row's placeholder.
 *
 * Mirrors the fill-and-check step of prototype `workoutAction('ramp-tick')`.
 */
export function rampTickFill(ramp: readonly SetEntry[], j: number, info: ExInfo): { w: string; r: string; ok: boolean } {
  const s = ramp[j] as SetEntry;
  const prevR = ramp[j - 1];
  let { w, r } = s;
  if (w === '' && prevR && prevR.done && prevR.rate === 'easy') w = String(r1(harder(num(prevR.w), info)));
  if (r === '') r = String(j === 0 ? info.lo + 2 : info.lo);
  return { w, r, ok: w !== '' };
}
