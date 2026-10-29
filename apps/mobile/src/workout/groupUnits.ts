import { GROUP_MAX, groupLabels, nextInRound, type GroupWithNext } from '@plate-and-bar/core';
import { listJoin } from './copy';
import type { ExState } from './model';

type Exs = readonly Pick<ExState, 'name' | 'group' | 'sets'>[];
/** What core's group rules read of the session's exercises. */
export const groupEx = (exs: Exs) => exs.map((e) => ({ name: e.name, sets: e.sets.length, group: e.group }));

/** A lone exercise or a whole superset: [start, end) in the session list. `labels` are the member letters of a superset, else empty. */
export interface Unit {
  start: number;
  end: number;
  labels: string[];
}

/** The session as units, by core's `groupLabels` (so a broken group reads as lone exercises). Every exercise is in exactly one unit, in order. */
export function groupUnits(exs: Exs): Unit[] {
  const l = groupLabels(groupEx(exs));
  const out: Unit[] = [];
  for (let i = 0; i < exs.length; i++) {
    const last = out[out.length - 1];
    if (last && l[i] && l[i] !== 'A' && last.labels.length) {
      last.end = i + 1;
      last.labels.push(l[i] as string);
    } else out.push({ start: i, end: i + 1, labels: l[i] ? [l[i] as string] : [] });
  }
  return out;
}

/** Rounds of a superset: as many as its longest member has sets. `done` is the number of leading rounds with every set of every member in it ticked. */
export function groupRounds(members: Exs): { total: number; done: number } {
  const total = Math.max(0, ...members.map((m) => m.sets.length));
  let done = 0;
  while (done < total && members.every((m) => !m.sets[done] || m.sets[done]?.done)) done++;
  return { total, done };
}

/** The set the user does next in the superset at [start, end): core's `nextInRound` over the ticks as they are, only when it is inside the group. */
export function upNext(exs: Exs, start: number, end: number): { ex: number; set: number } | null {
  const n = nextInRound(groupEx(exs), start, -1, (k, s) => !!exs[k]?.sets[s]?.done);
  return n && n.ex >= start && n.ex < end ? n : null;
}

/** The visible reason a "Superset with next" chip is disabled; null when the offer is hidden or allowed. `names` are the session's exercises. */
export function groupReason(r: GroupWithNext, names: readonly string[]): string | null {
  if (r.ok) return null;
  const n = names[r.ex] ?? '';
  switch (r.why) {
    case 'full':
      return `A superset holds up to ${GROUP_MAX} exercises.`;
    case 'done':
      return `${n} is already done, so it can’t join a superset.`;
    case 'same':
      return `${n} would be in this superset twice.`;
    default:
      return null;
  }
}

/** What removing `name` says: the toast, and for a superset left with 3 or more a line for the live region (the letters shifted). */
export function removalNote(exs: Exs, name: string): { toast: string; said?: string } {
  const i = exs.findIndex((e) => e.name === name);
  const u = groupUnits(exs).find((x) => x.start <= i && i < x.end);
  if (i < 0 || !u || u.labels.length === 0) return { toast: `${name} removed` };
  if (u.labels.length === 2) {
    const other = exs[i === u.start ? u.start + 1 : u.start]?.name ?? '';
    return { toast: `${name} removed. ${other} is no longer in a superset.` };
  }
  return { toast: `${name} removed`, said: `Superset is now ${listJoin(u.labels.slice(0, -1))}.` };
}

/** The rows core's group edits (`moveExercise`, `leaveGroup`, `joinWithNext`) work on: `k` is the exercise's index, so the result maps back to it. */
export const editRows = (exs: readonly Pick<ExState, 'name' | 'group' | 'sets' | 'part'>[]) => exs.map((e, k) => ({ name: e.name, sets: e.sets.length, group: e.group, part: e.part, k }));

/** The screen's exercises in the order and with the group ids of a core edit's result (rows from `editRows`). Ungrouped ones are `group: null`; the write adds the explicit null only where a group was stored (ADR 012). */
export const applyEdit = (exs: readonly ExState[], rows: readonly { k: number; group?: string | null }[]): ExState[] => rows.map((r) => ({ ...(exs[r.k] as ExState), group: r.group ?? null }));

/**
 * What a move says (a live region and, on iOS, an announcement): where the exercise is now, as `before` became `after`. In a superset: its letter; out of one:
 * that it left, and when that dissolved a pair, who is now alone.
 */
export function moveNote(before: Exs, after: Exs, name: string, dir: -1 | 1): string {
  const way = dir === -1 ? 'up' : 'down';
  const at = after.findIndex((e) => e.name === name);
  const from = before.findIndex((e) => e.name === name);
  const was = groupUnits(before).find((x) => x.labels.length > 0 && x.start <= from && from < x.end);
  const now = groupUnits(after).find((x) => x.start <= at && at < x.end);
  if (was && now && now.labels.length > 0) return `${name} moved ${way}, now ${now.labels[at - now.start]} of ${now.labels.length} in the superset.`;
  if (was) {
    const other = was.labels.length === 2 ? before.slice(was.start, was.end).find((e) => e.name !== name)?.name : undefined;
    return `${name} moved ${way} out of the superset, now ${at + 1} of ${after.length}.${other ? ` ${other} is no longer in a superset.` : ''}`;
  }
  return `${name} moved ${way}, now ${at + 1} of ${after.length}.`;
}

/** What taking `name` out of its superset says, as one toast: a superset left with 3 or more says its new letters, a pair says who is now alone. */
export function leaveNote(before: Exs, name: string): string {
  const i = before.findIndex((e) => e.name === name);
  const u = groupUnits(before).find((x) => x.start <= i && i < x.end);
  if (!u || u.labels.length < 2) return `${name} is not in a superset`;
  if (u.labels.length === 2) return `${name} is out of the superset. ${before[i === u.start ? u.start + 1 : u.start]?.name ?? ''} is no longer in a superset.`;
  return `${name} is out of the superset. Superset is now ${listJoin(u.labels.slice(0, -1))}.`;
}
