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
    case 'other':
      return `${n} is in another superset. Ungroup it first.`;
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
