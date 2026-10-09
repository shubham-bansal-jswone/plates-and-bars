import { addDays } from './dates';
import { isExcluded, type Exclusion, type Swap } from './exclusions';
import { snap, type ExInfo, type LiftRecord, type LiftSession, type SetEntry } from './progression';
import type { ExerciseCatalog } from './session';
import type { AdjState } from './stalls';

/** One ladder (prototype `LADDERS[key]`; content/exercises.json `ladders[key]`): steps from easiest, each a list of exercises. */
export interface Ladder {
  label: string;
  steps: readonly (readonly string[])[];
}

/** Prototype `LADDERS`, at content/exercises.json `ladders`. Key order matters: `ladderOf` returns the first ladder holding a name. */
export type Ladders = Readonly<Record<string, Ladder>>;

/** Where an exercise sits on its ladder: the ladder, its key, and the step index `i` (0 = easiest). */
export interface LadderPosition extends Ladder {
  key: string;
  i: number;
}

/** What the ladder rules read from the catalogue: `tags` (for exclusions and `sidewaysOf`) and `ladders`. */
export interface LadderCatalog extends Pick<ExerciseCatalog, 'tags'> {
  ladders: Ladders;
}

/**
 * The first ladder (in key order) holding the exercise, and its step, or null. The prototype's
 * "<label> ladder: step <i + 1> of <steps.length>" line (`ladderMeta`) is built from this.
 *
 * Mirrors prototype `ladderOf(name)` (`LADDERS` read from the catalogue's `ladders`).
 */
export function ladderOf(name: string, ladders: Ladders): LadderPosition | null {
  for (const [key, L] of Object.entries(ladders)) {
    const i = L.steps.findIndex((st) => st.includes(name));
    if (i >= 0) return { key, label: L.label, steps: L.steps, i };
  }
  return null;
}

/** The first exercise on the step above that no active rule covers; null at the top or when all are excluded. Mirrors prototype `nextStep(name)`. */
export function nextStep(name: string, exclusions: readonly Exclusion[], catalog: LadderCatalog): string | null {
  const l = ladderOf(name, catalog.ladders);
  if (!l || l.i >= l.steps.length - 1) return null;
  return (l.steps[l.i + 1] as readonly string[]).find((n) => !isExcluded(n, exclusions, catalog.tags)) || null;
}

/** The first exercise on the step below that no active rule covers; null at the bottom or when all are excluded. Mirrors prototype `prevStep(name)`. */
export function prevStep(name: string, exclusions: readonly Exclusion[], catalog: LadderCatalog): string | null {
  const l = ladderOf(name, catalog.ladders);
  if (!l || l.i === 0) return null;
  return (l.steps[l.i - 1] as readonly string[]).find((n) => !isExcluded(n, exclusions, catalog.tags)) || null;
}

/**
 * A sideways swap (the stall card's "Or switch to …" button): another exercise on the same ladder
 * step, else the first catalogue exercise of the same family and difficulty, skipping excluded ones.
 * Equipment is not checked. Null when there is none.
 *
 * Mirrors prototype `sidewaysOf(name)`.
 */
export function sidewaysOf(name: string, exclusions: readonly Exclusion[], catalog: LadderCatalog): string | null {
  const { tags } = catalog;
  const l = ladderOf(name, catalog.ladders);
  if (l) {
    const mate = (l.steps[l.i] as readonly string[]).find((n) => n !== name && !isExcluded(n, exclusions, tags));
    if (mate) return mate;
  }
  const t = tags[name];
  if (!t) return null;
  const alt = Object.entries(tags).find(([n, x]) => n !== name && x.family === t.family && x.difficulty === t.difficulty && !isExcluded(n, exclusions, tags));
  return alt ? alt[0] : null;
}

/**
 * Rough starting estimates when moving between variations (per dumbbell for dumbbell exercises):
 * `to`'s weight is about `from`'s top weight × `factor`. Order matters: `estimateFor` uses the first
 * pair with history.
 *
 * Mirrors prototype `PAIR` (`'from>to': x => x * factor`).
 */
export const ESTIMATE_PAIRS: readonly { readonly from: string; readonly to: string; readonly factor: number }[] = [
  { from: 'Dumbbell Bench Press', to: 'Barbell Bench Press', factor: 2.2 },
  { from: 'Incline Dumbbell Press', to: 'Barbell Bench Press', factor: 2.4 },
  { from: 'Barbell Bench Press', to: 'Dumbbell Bench Press', factor: 0.42 },
  { from: 'Seated Dumbbell Press', to: 'Standing Barbell Press', factor: 2.1 },
  { from: 'Standing Barbell Press', to: 'Seated Dumbbell Press', factor: 0.45 },
  { from: 'One-Arm Dumbbell Row', to: 'Barbell Row', factor: 1.6 },
  { from: 'Barbell Row', to: 'One-Arm Dumbbell Row', factor: 0.55 },
  { from: 'Dumbbell Romanian Deadlift', to: 'Barbell Romanian Deadlift', factor: 2.1 },
];

/** A first-time weight guess from a related exercise: its name, its top weight last time, and the guess. */
export interface Estimate {
  from: string;
  fromW: number;
  w: number;
}

/**
 * First-time weight guess for `name`: from the first `ESTIMATE_PAIRS` entry into `name` whose source
 * has a last session with a non-zero top weight, that weight × factor, snapped to the step (2.5 when
 * the step is 0) and at least one step. `info` is `name`'s `exInfo`. Null when no pair applies.
 *
 * Mirrors prototype `estimateFor(name)` (`S.lifts` and `exInfo(name)` passed in).
 */
export function estimateFor(name: string, lifts: Readonly<Record<string, Pick<LiftSession, 'sets'>>>, info: ExInfo): Estimate | null {
  for (const p of ESTIMATE_PAIRS) {
    if (p.to !== name) continue;
    const L = lifts[p.from];
    if (!L || !L.sets.length) continue;
    const top = Math.max(...L.sets.map((s) => s.w));
    if (!top) continue;
    const step = info.step || 2.5;
    return { from: p.from, fromW: top, w: Math.max(step, snap(top * p.factor, step)) };
  }
  return null;
}

/** What `ladderCard` reads from state. */
export interface LadderState {
  /** Today, `YYYY-MM-DD` (prototype `S.date`). */
  date: string;
  exclusions: readonly Exclusion[];
  /** Contract `Settings.ladder_stay` (prototype `settings.ladderStay`): name → last day the step-up card stays hidden. */
  ladderStay?: Readonly<Record<string, string>>;
  /** Contract `Settings.adjustments` (prototype `settings.adj`): `muted.ladder` and `dismissed` are read. */
  adj?: AdjState;
}

/**
 * A ladder card. `down`: "Step down to <to> for a few weeks?", `because` the last session's form broke
 * down (`form`) or else had failed sets (`fail`). `up`: "Ready to try <to>?", after `sessions`
 * sessions. `key` is the card's dismissal key (`down:` or `up:`, then `<name>:<date of the last record>`).
 */
export type LadderCard =
  | { kind: 'down'; key: string; to: string; because: 'form' | 'fail' }
  | { kind: 'up'; key: string; to: string; sessions: number };

/**
 * The ladder card for an exercise in today's session, or null. None once a set is ticked, without a
 * lift record, or with the `ladder` card muted. Step down when there is a step below and the last two
 * sessions each had form breaking down or a failed set. Otherwise step up when there is a step above,
 * no "stay on this step" answer covers `date`, and the lift has 4+ sessions whose last one hit `info.hi`
 * on every set, with no hard or failed set and no broken form. A dismissed key hides the card.
 * `info` is the exercise's `exInfo` (where-aware).
 *
 * Mirrors prototype `ladderCard(ex)` (state passed in; facts returned, not HTML).
 */
export function ladderCard(
  ex: { name: string; sets: readonly Pick<SetEntry, 'done'>[] },
  lifts: Readonly<Record<string, LiftRecord>>,
  info: ExInfo,
  state: LadderState,
  catalog: LadderCatalog,
): LadderCard | null {
  if (ex.sets.some((s) => s.done)) return null;
  const adj = state.adj || {};
  const L = lifts[ex.name];
  if (!L || (adj.muted || {}).ladder) return null;
  const dismissed = adj.dismissed || {};
  const rates = L.sets.map((s) => s.rate).filter(Boolean);
  const bad = (x: LiftSession | null | undefined): boolean => !!x && (x.form === 'no' || (x.sets || []).some((s) => s.rate === 'fail'));
  const down = prevStep(ex.name, state.exclusions, catalog);
  if (down && bad(L) && bad(L.prev)) {
    const key = `down:${ex.name}:${L.date}`;
    if (dismissed[key]) return null;
    return { kind: 'down', key, to: down, because: L.form === 'no' ? 'form' : 'fail' };
  }
  const up = nextStep(ex.name, state.exclusions, catalog);
  if (!up) return null;
  const stay = (state.ladderStay || {})[ex.name];
  if (stay && stay >= state.date) return null;
  const ready = (L.n || 0) >= 4 && L.sets.every((s) => s.r >= info.hi) && !rates.some((r) => r === 'hard' || r === 'fail') && L.form !== 'no' && !isExcluded(up, state.exclusions, catalog.tags);
  if (!ready) return null;
  const key = `up:${ex.name}:${L.date}`;
  if (dismissed[key]) return null;
  return { kind: 'up', key, to: up, sessions: L.n as number };
}

/**
 * The swap a ladder or stall card's button saves, in the contract's `Swap` fields (the prototype writes
 * `settings.repl[from]`). `up` ("Try it next session") keeps `from` as a bridge for 14 days
 * (`bridge_until` = `date` + 13); `down` ("Switch to …") and `side` (the stall card's "Or switch to …")
 * have no bridge. Also dismiss the card's key.
 *
 * Mirrors the `ladder-up`, `ladder-down` and `swap-side` steps of prototype `exAction`.
 */
export function ladderSwap(kind: 'up' | 'down' | 'side', from: string, to: string, date: string): Required<Pick<Swap, 'from' | 'to' | 'since' | 'bridge_until'>> {
  return { from, to, since: date, bridge_until: kind === 'up' ? addDays(date, 13) : null };
}

/**
 * "Stay on this step": the day to store in contract `Settings.ladder_stay[name]`; the step-up card
 * stays hidden through it (42 days from `date`). Also dismiss the card's key.
 *
 * Mirrors the `ladder-stay` step of prototype `exAction`.
 */
export function ladderStayUntil(date: string): string {
  return addDays(date, 42);
}
