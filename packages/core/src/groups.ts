import { restFor } from './workout';
import type { ExerciseCatalog } from './session';

/** A group has 2 to 6 members (ADR 012). Core constants, not in the contract schema. */
export const GROUP_MAX = 6;
export const GROUP_MIN = 2;
/** Rest in seconds after a set that is not the last of its round. */
export const GROUP_TRANSITION_SEC = 15;

/** What the group rules read of a session exercise (contract `WorkoutExercise`): name, set count and the optional group id. */
export type GroupEx = { name: string; sets: number; group?: string | null };

const ID = /^[A-Za-z0-9_-]{1,36}$/;
/** Contract pattern for a group id (`^[A-Za-z0-9_-]{1,36}$`). */
export const validId = (g: unknown): g is string => typeof g === 'string' && ID.test(g);
const gid = (e: GroupEx): string | null => (validId(e.group) ? e.group : null);

/** Runs of equal non-null ids as [start, end) pairs, in order. */
function runs(exs: readonly GroupEx[]): { id: string; a: number; b: number }[] {
  const out: { id: string; a: number; b: number }[] = [];
  for (let i = 0; i < exs.length; i++) {
    const id = gid(exs[i] as GroupEx);
    if (id === null) continue;
    const last = out[out.length - 1];
    if (last && last.id === id && last.b === i) last.b = i + 1;
    else out.push({ id, a: i, b: i + 1 });
  }
  return out;
}

/** The valid runs: 2 to 6 members and an id that appears in one run only. The one rule behind labels, order and rest. */
function validRuns(exs: readonly GroupEx[]): { a: number; b: number }[] {
  const all = runs(exs);
  const n = new Map<string, number>();
  for (const r of all) n.set(r.id, (n.get(r.id) ?? 0) + 1);
  return all.filter((r) => n.get(r.id) === 1 && r.b - r.a >= GROUP_MIN && r.b - r.a <= GROUP_MAX);
}

/**
 * The member letter of each exercise ('A', 'B', ... by order within its group), or null when ungrouped or when its group is not a
 * valid run (singleton, over 6, or id split into several runs). A set label is the letter plus the set number: 'A1', 'B1', 'A2'.
 *
 * New (#1182, ADR 012), not a prototype port: no prototype behaviour, no golden fixture. Tests load
 * docs/spec/golden/groups.json.
 */
export function groupLabels(exs: readonly GroupEx[]): (string | null)[] {
  const out: (string | null)[] = exs.map(() => null);
  for (const r of validRuns(exs)) for (let k = r.a; k < r.b; k++) out[k] = String.fromCharCode(65 + k - r.a);
  return out;
}

/**
 * Repair groups: a present id that fails the contract pattern (`^[A-Za-z0-9_-]{1,36}$`: empty, number, space, over 36 characters) becomes null; an id found in more than one run is dissolved entirely; a run under 2 members is dissolved; in a run over 6 the first
 * 6 stay and the rest are ungrouped. Dissolved members get `group: null` (explicit null, so a three-way merge sees the ungroup);
 * exercises that were not grouped are returned unchanged (key not added), and so are members of valid groups. Returns a new array,
 * never mutates, never reorders, never touches names or other keys. Idempotent.
 *
 * New (#1182, ADR 012), not a prototype port.
 */
export function normalizeGroups<E extends GroupEx>(exs: readonly E[]): E[] {
  const all = runs(exs);
  const count = new Map<string, number>();
  for (const r of all) count.set(r.id, (count.get(r.id) ?? 0) + 1);
  const clear = new Set<number>();
  exs.forEach((e, i) => {
    if (e.group !== undefined && e.group !== null && !validId(e.group)) clear.add(i);
  });
  for (const r of all) {
    const n = r.b - r.a;
    if (count.get(r.id) !== 1 || n < GROUP_MIN) for (let k = r.a; k < r.b; k++) clear.add(k);
    else for (let k = r.a + GROUP_MAX; k < r.b; k++) clear.add(k);
  }
  return exs.map((e, i) => (clear.has(i) ? { ...e, group: null } : e));
}

/** Whether set `s` of exercise `k` is done. The ticked set is treated as done by `nextInRound` and `restAfterTick`. */
export type IsDone = (ex: number, set: number) => boolean;

type Pos = { ex: number; set: number };

/** The run of `i` (a valid group, else just `i`) and the rounds-order scan helpers; `done` includes the ticked set (i, j). */
function scope(exs: readonly GroupEx[], i: number, j: number, done: IsDone) {
  const g = validRuns(exs).find((x) => x.a <= i && i < x.b);
  const a = g ? g.a : i;
  const b = g ? g.b : i + 1;
  const open = (k: number, s: number) => s < (exs[k] as GroupEx).sets && !(k === i && s === j) && !done(k, s);
  const rounds = g ? Math.max(...exs.slice(a, b).map((e) => e.sets)) : (exs[i] as GroupEx).sets;
  return { group: g !== undefined, a, b, open, rounds };
}

/**
 * The set to go to after set `j` of exercise `i` (both 0-based) is ticked, or null when nothing undone is left from `i` onward.
 * `done(k, s)` is the done state of every set; the ticked set counts as done. Ungrouped (mirrors the app's tick,
 * useWorkoutDay.ts:451-455): the first undone set of this exercise, else the first later exercise with an undone set (finished
 * ones skipped), else null. In a group the order alternates by round: A1, B1, A2, B2, the first undone set in that order (a member out
 * of sets drops out of later rounds); after the group, the first later exercise with an undone set. A group that is not a valid run
 * (see `groupLabels`) is treated as ungrouped. Assumes `exs` as given (call `normalizeGroups` first).
 *
 * New (#1182, ADR 012); the ungrouped case matches the app's done-state rule, not a prototype function.
 */
export function nextInRound(exs: readonly GroupEx[], i: number, j: number, done: IsDone): Pos | null {
  if (!exs[i]) return null;
  const c = scope(exs, i, j, done);
  // First open set of the run [a, b) in round order (a lone exercise is a run of one).
  const first = (a: number, b: number): Pos | null => {
    const rounds = Math.max(...exs.slice(a, b).map((e) => e.sets));
    for (let s = 0; s < rounds; s++) for (let k = a; k < b; k++) if (c.open(k, s)) return { ex: k, set: s };
    return null;
  };
  const here = first(c.a, c.b);
  if (here) return here;
  const runList = validRuns(exs);
  for (let k = c.b; k < exs.length; k++) {
    const g = runList.find((x) => x.a <= k && k < x.b);
    const n = g ? first(g.a, g.b) : first(k, k + 1);
    if (n) return n;
  }
  return null;
}

export type RestAfterTick = { kind: 'none' | 'transition' | 'round'; seconds: number; next: Pos | null };

/**
 * The rest to start when set `j` of exercise `i` is ticked, given the done state (`done`, the ticked set counts as done).
 * Kind 'none', 0 seconds when: `restOff` (the global rest setting; `next` still reported), nothing undone is left from `i` onward
 * (`next` null: the app starts no rest then), or `j` is not a set of any member of the group (for an ungrouped exercise: of the exercise). Otherwise ungrouped: kind 'round', the
 * normal `restFor`. In a group the round is open while another member still has an undone set at index `j` or earlier: then kind
 * 'transition', `GROUP_TRANSITION_SEC` (so ticking B1 before A1 is a transition); the tick that closes the round is kind 'round', the
 * longest `restFor` among the members still in that round. Warm-up and ramp ticks start no rest and are not part of rounds.
 *
 * New (#1182, ADR 012); ungrouped matches the app's done-state rule (useWorkoutDay.ts:451-455), not a prototype function.
 */
export function restAfterTick(exs: readonly GroupEx[], i: number, j: number, done: IsDone, o: { restOff: boolean; tags: ExerciseCatalog['tags'] }): RestAfterTick {
  const next = nextInRound(exs, i, j, done);
  if (o.restOff || !next) return { kind: 'none', seconds: 0, next };
  const c = scope(exs, i, j, done);
  const inRound: number[] = [];
  for (let k = c.a; k < c.b; k++) if ((exs[k] as GroupEx).sets > j) inRound.push(k);
  if (inRound.length === 0) return { kind: 'none', seconds: 0, next };
  if (c.group) {
    for (let s = 0; s <= j; s++) for (let k = c.a; k < c.b; k++) if (c.open(k, s)) return { kind: 'transition', seconds: GROUP_TRANSITION_SEC, next };
  }
  return { kind: 'round', seconds: Math.max(...inRound.map((k) => restFor((exs[k] as GroupEx).name, o.tags))), next };
}

/**
 * Whether exercise `i` can be grouped with the one after it (`merge: true` when that joins two groups into one), or why not: `last` and `inner` mean
 * the offer does not apply at all (no next exercise; `i` is not the last member of its group).
 */
export type GroupWithNext = { ok: true; merge?: true } | { ok: false; why: 'last' | 'inner' | 'full' | 'done' | 'same'; ex: number };

/**
 * Whether exercise `i` may be grouped with exercise `i + 1`: two ungrouped exercises start a group; an ungrouped one joins the group that
 * starts at the next; the last member of a group takes an ungrouped next one; the last member of a group and the first of the next group merge
 * the two (`merge: true`; #1345). Not allowed: the result over
 * `GROUP_MAX` (`full`), `i` or the next one fully done (`done`, ex which), the result holding one name twice (`same`, ex the one that would join: the next, or `i` when `i` is not in a group). The first reason
 * in that order is returned; groups that are not valid runs count as ungrouped. Rules that need the app (parts of the session, the first-time ramp) are not here.
 *
 * New (#1182, ADR 012), not a prototype port.
 */
export function canGroupWithNext(exs: readonly GroupEx[], i: number, done: IsDone): GroupWithNext {
  const a = exs[i];
  const b = exs[i + 1];
  if (!a || !b) return { ok: false, why: 'last', ex: i };
  const all = validRuns(exs);
  const ra = all.find((r) => r.a <= i && i < r.b);
  const rb = all.find((r) => r.a <= i + 1 && i + 1 < r.b);
  if (ra && i !== ra.b - 1) return { ok: false, why: 'inner', ex: i };
  const from = ra ? ra.a : i;
  const to = rb ? rb.b : i + 2;
  if (to - from > GROUP_MAX) return { ok: false, why: 'full', ex: i };
  const finished = (k: number) => {
    const e = exs[k] as GroupEx;
    return e.sets > 0 && Array.from({ length: e.sets }, (_, s) => done(k, s)).every(Boolean);
  };
  for (const k of [i, i + 1]) if (finished(k)) return { ok: false, why: 'done', ex: k };
  const names = exs.slice(from, to).map((e) => e.name);
  if (new Set(names).size !== names.length) return { ok: false, why: 'same', ex: ra ? i + 1 : i }; // the one that would join (a group's own names are unique)
  return ra && rb ? { ok: true, merge: true } : { ok: true };
}

/** An exercise list after a group edit: `to` is the new index of the exercise that was acted on. */
export type GroupEdit<E> = { exs: E[]; to: number };

/** The unit holding index `k`: a valid group run, else just `k`. */
const unitOf = (all: { a: number; b: number }[], k: number) => all.find((r) => r.a <= k && k < r.b) ?? { a: k, b: k + 1 };

/**
 * Groups exercise `i` with the next one when `canGroupWithNext` allows it, else null. Two ungrouped exercises get the id `make()`; joining
 * or appending keeps the id of the group involved; merging two groups gives the second group's members the first group's id. Returns the new
 * list (never mutates, order unchanged) and `members`, the [start, end) of the resulting group. A `make()` id that is not valid (`validId`) or is
 * already on another exercise refuses (null), so a bad id can never join two runs.
 *
 * New (#1345, ADR 012), not a prototype port.
 */
export function joinWithNext<E extends GroupEx>(exs: readonly E[], i: number, done: IsDone, make: () => string): { exs: E[]; members: [number, number]; merged: boolean } | null {
  const can = canGroupWithNext(exs, i, done);
  if (!can.ok) return null;
  const all = validRuns(exs);
  const ra = all.find((r) => r.a <= i && i < r.b);
  const rb = all.find((r) => r.a <= i + 1 && i + 1 < r.b);
  const from = ra ? ra.a : i;
  const to = rb ? rb.b : i + 2;
  const id = ra || rb ? gid(exs[ra ? ra.a : (rb as { a: number }).a] as E) : make();
  if (!validId(id) || (!ra && !rb && exs.some((e) => e.group === id))) return null;
  return { exs: exs.map((e, k) => (k >= from && k < to && e.group !== id ? { ...e, group: id } : e)), members: [from, to], merged: !!(ra && rb) };
}

/**
 * Moves exercise `i` one step (`dir` -1 up, +1 down) and keeps every group valid (2 to 6 members, contiguous); null when there is no step to take.
 * - A member of a group swaps with its neighbour inside the group (the letters follow the order).
 * - The first member moving up, or the last moving down, leaves the group (`group: null`) and hops over the whole unit next to the group (a lone exercise or another group).
 *   A group left with one member is dissolved, its member gets an explicit null.
 * - An ungrouped exercise hops over the whole unit next to it, so it never lands inside a group and never splits one.
 * - Nothing crosses a part boundary (`part` differs): that is null, as at either end of the list.
 * Returns `to`, the new index of the exercise. Never mutates.
 *
 * New (#1345, ADR 012), not a prototype port. Vectors: golden/group-edits.json.
 */
export function moveExercise<E extends GroupEx & { part?: number }>(exs: readonly E[], i: number, dir: -1 | 1): GroupEdit<E> | null {
  const e = exs[i];
  if (!e || (dir !== -1 && dir !== 1)) return null;
  const all = validRuns(exs);
  const own = all.find((r) => r.a <= i && i < r.b);
  const j = i + dir;
  if (own && j >= own.a && j < own.b) {
    const out = exs.slice();
    out[i] = exs[j] as E;
    out[j] = e;
    return { exs: out, to: j };
  }
  const k = dir === -1 ? (own ? own.a : i) - 1 : own ? own.b : i + 1; // the exercise next to this one's unit
  const near = exs[k];
  if (!near) return null;
  const unit = unitOf(all, k);
  if (e.part !== undefined && near.part !== undefined && e.part !== near.part) return null;
  const rest = exs.filter((_, x) => x !== i);
  const to = dir === -1 ? unit.a : unit.b - 1;
  rest.splice(to, 0, own ? { ...e, group: null } : e);
  return { exs: normalizeGroups(rest), to };
}

/**
 * Takes exercise `i` out of its group and keeps it in the session; null when it is in no valid group. The first member stays where it is; any
 * other member goes right after the group (so the rest stays contiguous). The member gets an explicit `group: null`. A group of two is dissolved
 * (`dissolved`: the other member gets an explicit null too). Never mutates.
 *
 * New (#1345, ADR 012), not a prototype port. Vectors: golden/group-edits.json.
 */
export function leaveGroup<E extends GroupEx>(exs: readonly E[], i: number): (GroupEdit<E> & { dissolved: boolean }) | null {
  const own = validRuns(exs).find((r) => r.a <= i && i < r.b);
  const e = exs[i];
  if (!own || !e) return null;
  const to = i === own.a ? i : own.b - 1;
  const rest = exs.filter((_, x) => x !== i);
  rest.splice(to, 0, { ...e, group: null });
  return { exs: normalizeGroups(rest), to, dissolved: own.b - own.a === GROUP_MIN };
}
