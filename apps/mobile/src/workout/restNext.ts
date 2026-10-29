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
  return exs.some((e) => e.group) ? t : { ...t, from: exs.slice(i).map((e) => e.name), ids: exs.slice(i).map((e) => e.sets.map((x) => x.id)) };
}

const open = (e: Exs[number]) => e.sets.some((x) => !x.done);

/**
 * The ungrouped dock, exactly as before groups: the first name in `from` with an undone set becomes the label ('Next: Name') and the list is cut to start
 * there; none left closes it; while the first is still open nothing changes. Each entry is found by the set row ids it had at the tick (`r.ids`), so an
 * insert or removal elsewhere, or a can't-do swap, cannot move it; this is what tells two exercises with one name apart (#1329). Only an entry whose rows
 * are all gone (removed, replaced by fresh rows, or renamed by a swap) is looked for by name, after the exercise matched before it and before the next one found by rows.
 * An older stored rest has no ids: its names are matched in order from the first one's place `at.i` (the last copy at or before it, else the start).
 */
function retargetNames(exs: Exs, r: RestNext): RestNext | null {
  const from = r.from!;
  const ids = r.ids;
  const head = from[0] ?? '';
  const at = r.at?.i ?? 0;
  const copies = exs.flatMap((e, m) => (e.name === head ? [m] : []));
  const lo = copies.length === 0 ? 0 : (copies.filter((m) => m <= at).pop() ?? 0);
  // An entry renamed since (a swap: the screen renames it in `from`) no longer names the exercise that holds its rows: it is looked for by name.
  const byRows = from.map((n, j) => (ids?.[j]?.length ? exs.findIndex((e) => e.name === n && e.sets.some((x) => ids[j]!.includes(x.id))) : -1));
  let prev = ids ? -1 : lo - 1;
  const pos = from.map((n, j) => {
    let m = byRows[j]!;
    if (m < 0) {
      const next = byRows.slice(j + 1).find((q) => q >= 0) ?? exs.length;
      m = exs.findIndex((e, k) => k > prev && k < next && e.name === n);
    }
    if (m >= 0) prev = m;
    return m;
  });
  const j = pos.findIndex((m) => m >= 0 && open(exs[m]!));
  if (j < 0) return null;
  const p = pos[j]!;
  const first = from[j]!;
  if (j === 0) return ids || p === r.at?.i ? r : { ...r, at: { i: p, name: head } };
  return { ...r, from: from.slice(j), ...(ids ? { ids: ids.slice(j) } : {}), at: { i: p, name: first }, to: { ex: p, set: exs[p]!.sets.findIndex((x) => !x.done), name: first }, label: `Next: ${first}` };
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
