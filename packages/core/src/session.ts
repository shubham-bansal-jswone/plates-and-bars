import { beginnerRamp, exerciseCap, older, type PlanProfile, type SessionLog, type Where } from './plan';
import type { ExerciseMeta } from './progression';

/**
 * Exercise tags, as in prototype `TAGS` (built with `TG`), with content/exercises.json's field names.
 * Prototype short name in brackets: movement `pattern` (`p`), `family` (`f`), `equipment` (`eq`),
 * `difficulty` 1–3 (`d`), `primary` muscles (`m`), `secondary` muscles (`s`), `joints` loaded (`j`).
 */
export interface ExerciseTag {
  pattern: string;
  family: string;
  equipment: string;
  difficulty: number;
  primary: readonly string[];
  secondary: readonly string[];
  joints: readonly string[];
}

/** Prototype `AWAY`: gym name → [dumbbells-only, bodyweight-only]; `null` leaves it out. */
export type AwayMap = Readonly<Record<string, readonly (string | null)[]>>;

/**
 * The exercise content the rules read: the `tags`, `meta`, `cards` and `away_map` fields of
 * content/exercises.json, passed in as is (other fields are ignored). It is content data (spec item 4),
 * not rules, so it is passed in rather than copied here. `tags` key order matters: `focusPick` breaks
 * ties by it, as the prototype does with `Object.entries(TAGS)` (built-in tags first, then user custom
 * tags).
 */
export interface ExerciseCatalog {
  /** Prototype `TAGS`, custom tags included. */
  tags: Readonly<Record<string, ExerciseTag>>;
  /** Prototype `EX_META` (type and rep range per exercise), custom exercises included. */
  meta: Readonly<Record<string, ExerciseMeta>>;
  /** Prototype `CARDS`: only whether a name has a card is read, never a card's fields. */
  cards: Readonly<Record<string, unknown>>;
  /** Prototype `AWAY`, at `away_map.dumbbells_bodyweight`. */
  away_map: { readonly dumbbells_bodyweight: AwayMap };
}

/** One exercise in a session being built. `bridge`: the old exercise kept for 2 weeks after a swap. */
export interface SessionItem {
  name: string;
  bridge?: boolean;
  /** Set on exercises `applyFocus` added. */
  focus?: boolean;
}

/** Swap rules keyed by the original exercise (prototype `S.settings.repl`); only `to` is read here. */
export type ReplaceRules = Readonly<Record<string, { to?: string | null }>>;

/** Mirrors prototype `COMPOUND`: patterns that count as compound lifts. */
export const COMPOUND: ReadonlySet<string> = new Set(['h-press', 'v-press', 'squat', 'lunge', 'hinge', 'h-pull', 'v-pull', 'hip-ext', 'dip']);

/** The balance exercise added for adults 60+ (prototype `buildSession`). */
export const BALANCE_EXERCISE = 'Single-Leg Balance (seconds)';

const PUSH_M = ['chest', 'front-delt', 'side-delt', 'triceps'];
const PULL_M = ['lats', 'upper-back', 'rear-delt', 'biceps', 'forearms'];
const LOWER_M = ['quads', 'hams', 'glutes', 'calves'];

/**
 * Template names for training away from a gym: each name maps through the away map (dumbbells or
 * bodyweight column), names mapped to `null` drop out, and duplicates keep their first place.
 *
 * Mirrors prototype `mapForWhere(names, where)` (`AWAY` read from the catalogue's `away_map`).
 */
export function mapForWhere(names: readonly string[], where: Where, catalog: Pick<ExerciseCatalog, 'away_map'>): string[] {
  if (where === 'gym') return [...names];
  const k = where === 'dumbbells' ? 0 : 1;
  const away = catalog.away_map.dumbbells_bodyweight;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const a = away[n];
    const m = a ? a[k] : n;
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/** What `trimSession` reads from state. */
export interface TrimState {
  profile?: PlanProfile | null;
  sessions: SessionLog;
  repl?: ReplaceRules;
}

/**
 * Cuts a session to the exercise cap. The first 2 exercises always stay; the remaining slots rotate
 * through the rest by how many times template `t` has been logged. Bridge items stay when the
 * exercise they were swapped to stays.
 *
 * Mirrors prototype `trimSession(items, t)`.
 */
export function trimSession(items: readonly SessionItem[], t: string, state: TrimState): SessionItem[] {
  const cap = exerciseCap(state.profile);
  const main = items.filter((x) => !x.bridge);
  if (main.length <= cap) return [...items];
  const keep = Math.min(2, cap);
  const head = main.slice(0, keep);
  const rest = main.slice(keep);
  const slots = cap - keep;
  const n = Object.values(state.sessions).filter((e) => e.t === t).length;
  const off = rest.length ? (n * slots) % rest.length : 0;
  const pick = Array.from({ length: slots }, (_, i) => rest[(off + i) % rest.length] as SessionItem);
  const chosen = new Set([...head, ...pick].map((x) => x.name));
  const repl = state.repl ?? {};
  return items.filter((x) => chosen.has(x.name) || (x.bridge && chosen.has((repl[x.name] || {}).to as string)));
}

/** Whether focus muscle `m` belongs on template `t`. Mirrors prototype `muscleAllowed(t, m)`. */
export function muscleAllowed(t: string, m: string): boolean {
  if (m === 'abs' || m === 'lower-back') return true;
  if (/^Push/.test(t)) return PUSH_M.includes(m);
  if (/^Pull/.test(t)) return PULL_M.includes(m);
  if (/^(Legs|Lower)/.test(t)) return LOWER_M.includes(m);
  if (/^Upper/.test(t)) return PUSH_M.includes(m) || PULL_M.includes(m);
  return true;
}

/** Mirrors prototype `focusList()`: at most the first 3 focus muscles. */
function focusList(focus: readonly string[] | null | undefined): string[] {
  return (focus || []).slice(0, 3);
}

/** True when an exercise's primary muscles include a focus muscle. Mirrors prototype `isFocus(name)`. */
export function isFocus(name: string, focus: readonly string[] | null | undefined, tags: ExerciseCatalog['tags']): boolean {
  const t = tags[name];
  const F = focusList(focus);
  return !!t && t.primary.some((m) => F.includes(m));
}

/** What `applyFocus` reads from state. */
export interface FocusState {
  profile?: PlanProfile | null;
  /** Focus muscles (prototype `S.settings.focus`); only the first 3 count. */
  focus?: readonly string[] | null;
  /** Lift history keyed by exercise (prototype `S.lifts`); only presence is read. */
  lifts?: Readonly<Record<string, unknown>>;
  /** Exclusion check (prototype `isExcluded(name)`). Defaults to nothing excluded. */
  isExcluded?: (name: string) => boolean;
}

/**
 * The best exercise to add for focus muscle `m`: one with `m` as a primary muscle, not already in
 * the session, not excluded, usable with the equipment at `where`, and with a card.
 *
 * Mirrors prototype `focusPick(m, taken, where)`.
 */
export function focusPick(m: string, taken: ReadonlySet<string>, where: Where, state: FocusState, catalog: ExerciseCatalog): string | null {
  const allow = where === 'gym' ? null : where === 'dumbbells' ? ['dumbbell', 'bodyweight'] : ['bodyweight'];
  const p = state.profile || {};
  const lifts = state.lifts || {};
  const excluded = state.isExcluded ?? (() => false);
  const best = Object.entries(catalog.tags)
    .filter(([n, t]) => t.primary.includes(m) && !taken.has(n) && !excluded(n) && (!allow || allow.includes(t.equipment)) && catalog.cards[n])
    .map(([n, t]) => ({
      n,
      sc: (t.primary[0] === m ? 3 : 0) + (t.primary.length === 1 ? 2 : 0) + (lifts[n] ? 2 : 0) - (p.exp === 'new' && t.difficulty === 3 ? 5 : 0) - t.joints.length * 0.5,
    }))
    .sort((a, b) => b.sc - a.sc);
  return best[0] ? best[0].n : null;
}

/**
 * Applies focus muscles to a session: adds an exercise for each focus muscle allowed on template
 * `t` that nothing in the session trains, moves focus work earlier (focus compounds first, else
 * focus isolation after the first lift), then drops non-focus extras from the end to stay within
 * the exercise cap (plus bridges).
 *
 * Mirrors prototype `applyFocus(items, t, where)`.
 */
export function applyFocus(items: readonly SessionItem[], t: string, where: Where | null | undefined, state: FocusState, catalog: ExerciseCatalog): SessionItem[] {
  const { tags } = catalog;
  const F = focusList(state.focus).filter((m) => muscleAllowed(t, m));
  if (!F.length) return [...items];
  let out = items.slice();
  const cap = exerciseCap(state.profile) + out.filter((x) => x.bridge).length;
  for (const m of F) {
    if (out.some((x) => tags[x.name] && tags[x.name]?.primary.includes(m))) continue;
    const n = focusPick(m, new Set(out.map((x) => x.name)), where || 'gym', state, catalog);
    if (!n) continue;
    out.push({ name: n, focus: true });
  }
  const foc = (x: SessionItem) => isFocus(x.name, state.focus, tags);
  const comp = (x: SessionItem) => !!tags[x.name] && COMPOUND.has((tags[x.name] as ExerciseTag).pattern);
  const fc = out.filter((x) => foc(x) && comp(x) && !x.bridge);
  const fi = out.filter((x) => foc(x) && !comp(x) && !x.bridge);
  const rest = out.filter((x) => !fc.includes(x) && !fi.includes(x));
  out = fc.length ? [...fc, ...fi, ...rest] : [...rest.slice(0, 1), ...fi, ...rest.slice(1)];
  while (out.length > cap) {
    const k = out
      .map((_, i) => i)
      .reverse()
      .find((i) => i > 1 && !foc(out[i] as SessionItem) && !out[i]?.bridge);
    if (k === undefined) break;
    out.splice(k, 1);
  }
  return out;
}

/**
 * The check-in "short session" cut: no bridges, at most 3 exercises for 30 minutes, 4 otherwise.
 * `time` is the check-in answer (`'usual' | '45' | '30'`); absent or `'usual'` leaves items alone.
 *
 * Mirrors the `short` step inline in prototype `buildSession(t)`.
 */
export function shortSession(items: readonly SessionItem[], time: string | null | undefined): SessionItem[] {
  if (!time || time === 'usual') return [...items];
  return items.filter((x) => !x.bridge).slice(0, time === '30' ? 3 : 4);
}

/**
 * Working sets for an exercise before focus, deload or light-day changes: 2 during the beginner
 * fortnight (this wins over the calf rule), else at least 4 for calf raises, else `base`.
 *
 * Mirrors prototype `setsFor(name, base)` (profile, date and tags passed in).
 */
export function setsFor(name: string, base: number, profile: PlanProfile | null | undefined, date: string, tags: ExerciseCatalog['tags']): number {
  const t = tags[name];
  let n = base;
  if (beginnerRamp(profile, date)) n = 2;
  else if (t && t.pattern === 'calf') n = Math.max(n, 4);
  return n;
}

/** Inputs to `sessionSets` besides the items. */
export interface SessionSetsOptions {
  profile?: PlanProfile | null;
  /** The session's date, `YYYY-MM-DD`. */
  date: string;
  focus?: readonly string[] | null;
  tags: ExerciseCatalog['tags'];
  /** Sets logged last time for an exercise, or `undefined` if never done (prototype `lastFor(name).sets.length`). */
  lastSets?: (name: string) => number | undefined;
  /** Recovery week in range (prototype `inRange(A.deload)`). */
  deload?: boolean;
  /**
   * Light session: check-in "light", re-entry of 30%+, lab hold, or `needsClearance`
   * (prototype `buildSession`'s `light`). Ignored in a deload week.
   */
  light?: boolean;
}

/** An exercise with its number of working sets. */
export interface SessionExercise {
  name: string;
  sets: number;
  bridge?: true;
}

/**
 * Set counts for a built session: start from last time's sets (at least 3), apply `setsFor`, +1 on
 * focus exercises, at most 5; bridges get 2. A deload keeps ~60% (at least 2); a light day drops one
 * set from exercises with more than 2. Adults 60+ get the balance exercise with 2 sets at the end.
 *
 * Mirrors the set-count steps of prototype `buildSession(t)` and `newExercise(name)`.
 */
export function sessionSets(items: readonly SessionItem[], o: SessionSetsOptions): SessionExercise[] {
  const ex: SessionExercise[] = items.map((it) => {
    const last = o.lastSets?.(it.name);
    const base = last !== undefined ? Math.max(3, last) : 3;
    const n = setsFor(it.name, base, o.profile, o.date, o.tags) + (isFocus(it.name, o.focus, o.tags) ? 1 : 0);
    // Prototype: pad to n sets, then slice to min(n, 5).
    const sets = Math.min(Math.max(base, n), n, 5);
    if (it.bridge) return { name: it.name, sets: Math.min(sets, 2), bridge: true };
    return { name: it.name, sets };
  });
  for (const e of ex) {
    if (o.deload) e.sets = Math.min(e.sets, Math.max(2, Math.ceil(e.sets * 0.6)));
    else if (o.light && e.sets > 2) e.sets -= 1;
  }
  if (older(o.profile) && !ex.some((e) => e.name === BALANCE_EXERCISE)) ex.push({ name: BALANCE_EXERCISE, sets: 2 });
  return ex;
}
