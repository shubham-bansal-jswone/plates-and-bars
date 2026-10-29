import { groupLabels, nextInRound } from '@plate-and-bar/core';
import type { ExState } from './model';
import type { RestNext, RestState } from './parts';

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
 * there; none left closes it; while the first is still open nothing changes. An entry is found by the set row ids it had at the tick (`r.ids`) when exactly
 * one exercise of that name holds them, so an insert or removal elsewhere cannot move it. Otherwise (no holder: removed, fresh rows or renamed by a swap;
 * or several: two exercises with one name share rows after a load, #1340) it is found by position: the first one's place is the last copy of its name at
 * or before `at.i` (kept current here), else the first; each later entry is the first match after the previous one and before the next one found by
 * rows. That is what tells same-named exercises apart (#1329); a finished one is never stood in for by a later copy.
 */
function retargetNames(exs: Exs, r: RestNext): RestNext | null {
  const from = r.from!;
  const ids = r.ids;
  const head = from[0] ?? '';
  const at = r.at?.i ?? 0;
  const copies = exs.flatMap((e, m) => (e.name === head ? [m] : []));
  const lo = copies.length === 0 ? 0 : (copies.filter((m) => m <= at).pop() ?? 0);
  const byRows = from.map((n, j) => {
    const held = exs.flatMap((e, m) => (e.name === n && e.sets.some((x) => ids?.[j]?.includes(x.id)) ? [m] : []));
    return held.length === 1 ? held[0]! : -1;
  });
  let prev = lo - 1;
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
  if (j === 0) return p === r.at?.i ? r : { ...r, at: { i: p, name: head } };
  return { ...r, from: from.slice(j), ...(ids ? { ids: ids.slice(j) } : {}), at: { i: p, name: first }, to: { ex: p, set: exs[p]!.sets.findIndex((x) => !x.done), name: first }, label: `Next: ${first}` };
}

/**
 * A can't-do swap of the exercise `name` that holds the set rows `rows`: the entries of the rest's list that named it now name `choice`. With row ids only the
 * entries holding those rows (not another copy of the name), or having none left (renamed before); an older rest (no ids) renames by name. A renamed entry
 * drops its ids (the replacement has fresh rows), so it is found by name. The label changes when the first entry was renamed.
 */
export function renameSwapped(r: RestState, name: string, rows: readonly string[], choice: string): RestState {
  const hit = (n: string, k: number) => n === name && (!r.ids || !r.ids[k]?.length || r.ids[k]!.some((id) => rows.includes(id)));
  if (!r.from?.some(hit)) return r;
  return { ...r, ...(hit(r.from[0]!, 0) ? { label: `Next: ${choice}` } : {}), from: r.from.map((n, k) => (hit(n, k) ? choice : n)), ...(r.ids ? { ids: r.ids.map((l, k) => (hit(r.from![k]!, k) ? [] : l)) } : {}) };
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
