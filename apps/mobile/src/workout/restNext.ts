import { groupLabels, nextInRound } from '@plate-and-bar/core';
import type { ExState } from './model';
import type { RestNext } from './parts';

type Exs = readonly Pick<ExState, 'name' | 'group' | 'sets'>[];
const gx = (exs: Exs) => exs.map((e) => ({ name: e.name, sets: e.sets.length, group: e.group }));

/** The dock text for the set `to` (a position in `exs`) after the set just ticked in exercise `from`: 'Next: B1 Name' in a group, else the ungrouped wording. */
export function restLabel(exs: Exs, from: number, to: { ex: number; set: number }): string {
  const e = exs[to.ex];
  const letter = groupLabels(gx(exs))[to.ex];
  if (!e) return '';
  if (letter) return `Next: ${letter}${to.set + 1} ${e.name}`;
  return to.ex === from ? `Next: set ${to.set + 1} of ${e.name}` : `Next: ${e.name}`;
}

/**
 * The dock target for the next set `n` (core's `next`) after a tick in exercise `i`, by position and with the exercise names at that time.
 * An ungrouped session also keeps the names from the ticked exercise onward (`from`): its dock follows them as it did before groups (restRetarget).
 */
export function restTarget(exs: Exs, i: number, n: { ex: number; set: number }): RestNext {
  const t: RestNext = { at: { i, name: exs[i]?.name ?? '' }, to: { ex: n.ex, set: n.set, name: exs[n.ex]?.name ?? '' }, label: restLabel(exs, i, n) };
  return exs.some((e) => e.group) ? t : { ...t, from: exs.slice(i).map((e) => e.name) };
}

const open = (e: Exs[number]) => e.sets.some((x) => !x.done);
/** The index of the exercise named `name` nearest to `near` (the lower one on a tie), or -1. */
const nearest = (exs: Exs, name: string, near: number) =>
  exs.reduce((b, e, k) => (e.name === name && (b < 0 || Math.abs(k - near) < Math.abs(b - near)) ? k : b), -1);

/**
 * The ungrouped dock, exactly as before groups: the first name in `from` with an undone set becomes the label ('Next: Name') and the list is cut to start
 * there; none left closes it; while the first is still open nothing changes. Names are only looked for from the first one's position onward (`at.i`,
 * kept up to date here), so an earlier exercise with the same name cannot stand in for a finished one (#1329).
 */
function retargetNames(exs: Exs, r: RestNext): RestNext | null {
  const from = r.from!;
  const head = from[0] ?? '';
  const at = r.at?.i ?? 0;
  const k = exs[at]?.name === head ? at : nearest(exs, head, at); // ponytail: a removal before an equal-named head can mislead this (sync-made duplicates only)
  const lo = k >= 0 ? k : at; // the first one is gone: its followers are at its place now
  const pos = (n: string) => exs.findIndex((e, m) => m >= lo && e.name === n && open(e));
  const first = from.find((n) => pos(n) >= 0);
  if (first === undefined) return null;
  const p = pos(first);
  if (first === head) return p === r.at?.i ? r : { ...r, at: { i: p, name: head } };
  return { ...r, from: from.slice(from.indexOf(first)), at: { i: p, name: first }, to: { ex: p, set: exs[p]!.sets.findIndex((x) => !x.done), name: first }, label: `Next: ${first}` };
}

/**
 * The dock target while the rest runs and the session changes (a removal, a swap, a set ticked). Ungrouped: the names rule above. Grouped: the stored
 * target while that set is still open and still the same exercise, else the first undone set of core's round order after the ticked exercise, else
 * null (the dock closes). Never by name alone, so two exercises with one name cannot stand in for each other (#1329). Nothing counts as just ticked
 * here (set -1), so a later untick cannot change the dock; only the first tick (restTarget) treats its set as done.
 */
export function restRetarget(exs: Exs, r: RestNext): RestNext | null {
  if (r.from) return retargetNames(exs, r);
  const e = exs[r.to.ex];
  if (e && e.name === r.to.name && e.sets[r.to.set] && !e.sets[r.to.set]?.done) return r;
  // The ticked exercise may have moved (an earlier one was removed): find it again by name, else keep its place (without its "set N of" wording).
  const found = exs[r.at.i]?.name === r.at.name ? r.at.i : exs.findIndex((x) => x.name === r.at.name);
  const i = found >= 0 ? found : r.at.i;
  const n = nextInRound(gx(exs), i, -1, (k, s) => !!exs[k]?.sets[s]?.done);
  return n && { ...restTarget(exs, i, n), label: restLabel(exs, found, n) };
}
