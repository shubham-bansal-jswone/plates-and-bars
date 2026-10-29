import { restFor } from './workout';
import type { ExerciseCatalog } from './session';

/** A group has 2 to 6 members (ADR 012). Core constants, not in the contract schema. */
export const GROUP_MAX = 6;
export const GROUP_MIN = 2;
/** Rest in seconds after a set that is not the last of its round. */
export const GROUP_TRANSITION_SEC = 15;

/** What the group rules read of a session exercise (contract `WorkoutExercise`): name, set count and the optional group id. */
export type GroupEx = { name: string; sets: number; group?: string | null };

const gid = (e: GroupEx): string | null => (typeof e.group === 'string' && e.group !== '' ? e.group : null);

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

/** The valid group run (2 to 6 contiguous members) holding index `i`, or null. */
function runOf(exs: readonly GroupEx[], i: number): { a: number; b: number } | null {
  const r = runs(exs).find((x) => x.a <= i && i < x.b);
  return r && r.b - r.a >= GROUP_MIN && r.b - r.a <= GROUP_MAX ? r : null;
}

/**
 * The member letter of each exercise ('A', 'B', ... by order within its group), or null when ungrouped or when its group is not a
 * valid run (singleton, over 6, or id split into several runs). A set label is the letter plus the set number: 'A1', 'B1', 'A2'.
 *
 * New (#1182, ADR 012), not a prototype port: no prototype behaviour, no golden fixture. Tests load
 * packages/api/test-vectors/groups.json.
 */
export function groupLabels(exs: readonly GroupEx[]): (string | null)[] {
  const byId = new Map<string, number>();
  for (const r of runs(exs)) byId.set(r.id, (byId.get(r.id) ?? 0) + 1);
  const out: (string | null)[] = exs.map(() => null);
  for (const r of runs(exs)) {
    if (byId.get(r.id) !== 1 || r.b - r.a < GROUP_MIN || r.b - r.a > GROUP_MAX) continue;
    for (let k = r.a; k < r.b; k++) out[k] = String.fromCharCode(65 + k - r.a);
  }
  return out;
}

/**
 * Repair groups: an id found in more than one run is dissolved entirely; a run under 2 members is dissolved; in a run over 6 the first
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
  for (const r of all) {
    const n = r.b - r.a;
    if (count.get(r.id) !== 1 || n < GROUP_MIN) for (let k = r.a; k < r.b; k++) clear.add(k);
    else for (let k = r.a + GROUP_MAX; k < r.b; k++) clear.add(k);
  }
  return exs.map((e, i) => (clear.has(i) ? { ...e, group: null } : e));
}

/**
 * The set that follows (exercise `i`, set `j`, both 0-based) and the exercise index and set index of it, or null at the end.
 * Ungrouped: the next set of the same exercise, then the next exercise's first set. In a group the order alternates by round:
 * A1, B1, A2, B2; a member out of sets drops out of later rounds; after the last round, the first exercise after the group.
 * A group that is not a valid run is treated as ungrouped. Assumes `exs` as given (call `normalizeGroups` first).
 *
 * New (#1182, ADR 012), not a prototype port.
 */
export function nextInRound(exs: readonly GroupEx[], i: number, j: number): { ex: number; set: number } | null {
  const r = runOf(exs, i);
  if (r) {
    for (let k = i + 1; k < r.b; k++) if ((exs[k] as GroupEx).sets > j) return { ex: k, set: j };
    // The first member with sets left in round j+1 is the first with sets > j+1 (a member out of sets drops out).
    for (let k = r.a; k < r.b; k++) if ((exs[k] as GroupEx).sets > j + 1) return { ex: k, set: j + 1 };
    return r.b < exs.length ? { ex: r.b, set: 0 } : null;
  }
  const e = exs[i];
  if (e && j + 1 < e.sets) return { ex: i, set: j + 1 };
  return i + 1 < exs.length ? { ex: i + 1, set: 0 } : null;
}

export type RestAfterTick = { kind: 'none' | 'transition' | 'round'; seconds: number; next: { ex: number; set: number } | null };

/**
 * The rest to start when set `j` of exercise `i` is ticked. `restOff` (the global rest setting) gives kind 'none', 0 seconds.
 * Ungrouped, or a group's last undone member of the round: kind 'round', the normal `restFor` (for a group, the longest `restFor` among
 * the members still in that round). An earlier member of a round: kind 'transition', `GROUP_TRANSITION_SEC`. `next` is `nextInRound`.
 * Warm-up and ramp stay a per-exercise pre-step and are not part of rounds.
 *
 * New (#1182, ADR 012), not a prototype port. Ungrouped input gives exactly `restFor(name, tags)`.
 */
export function restAfterTick(exs: readonly GroupEx[], i: number, j: number, o: { restOff: boolean; tags: ExerciseCatalog['tags'] }): RestAfterTick {
  const next = nextInRound(exs, i, j);
  if (o.restOff) return { kind: 'none', seconds: 0, next };
  const r = runOf(exs, i);
  if (!r) return { kind: 'round', seconds: restFor((exs[i] as GroupEx).name, o.tags), next };
  const inRound: number[] = [];
  for (let k = r.a; k < r.b; k++) if ((exs[k] as GroupEx).sets > j) inRound.push(k);
  const lastIdx = inRound[inRound.length - 1] as number;
  if (i < lastIdx) return { kind: 'transition', seconds: GROUP_TRANSITION_SEC, next };
  return { kind: 'round', seconds: Math.max(...inRound.map((k) => restFor((exs[k] as GroupEx).name, o.tags))), next };
}
