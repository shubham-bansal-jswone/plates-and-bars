import { groupLabels, nextInRound } from '@plate-and-bar/core';
import type { ExState } from './model';
import type { GroupNext } from './parts';
import { groupUnits } from './groupUnits';

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
 */
export function restTarget(exs: Exs, i: number, n: { ex: number; set: number }): GroupNext {
  return { at: { i, name: exs[i]?.name ?? '' }, to: { ex: n.ex, set: n.set, name: exs[n.ex]?.name ?? '' }, label: restLabel(exs, i, n) };
}

/**
 * The dock target while the rest runs and the session changes of a grouped session (a removal, a swap, a set ticked, an ungroup): the stored
 * target while that set is still open and still the same exercise (its label is derived again, so letters follow a group that was dissolved or re-lettered), else the first undone set of core's round order after the ticked exercise, else
 * null (the dock closes). Never by name alone, so two exercises with one name cannot stand in for each other (#1329). Nothing counts as just ticked
 * here (set -1); only the first tick (restTarget) treats its set as done. In a superset the dock also follows core's next set whenever that is inside the
 * ticked exercise's superset (or, when it is in none, the superset that holds the stored target), so an untick moves it (the "Up next" marker is the same call and must agree; #1182 S5). The rest itself
 * (seconds, start) is unchanged: it starts only on a tick. Ungrouped exercises keep the stored target, so a later untick cannot change their dock.
 */
export function restRetarget(exs: Exs, r: GroupNext): GroupNext | null {
  const e = exs[r.to.ex];
  // The ticked exercise may have moved (an earlier one was removed): find it again by name, else keep its place (without its "set N of" wording).
  const found = exs[r.at.i]?.name === r.at.name ? r.at.i : exs.findIndex((x) => x.name === r.at.name);
  const done = (k: number, s: number) => !!exs[k]?.sets[s]?.done;
  const at = found >= 0 ? found : r.at.i;
  const units = groupUnits(exs).filter((u) => u.labels.length > 0);
  const own = units.find((u) => u.start <= at && at < u.end);
  // The ticked exercise is in no superset: use the superset that holds the stored target (the rest after the last set before a superset), if any.
  const unit = own ?? (e && e.name === r.to.name ? units.find((u) => u.start <= r.to.ex && r.to.ex < u.end) : undefined);
  if (unit) {
    const g = nextInRound(gx(exs), own ? at : unit.start, -1, done);
    // Defensive: from inside the superset core's answer is always inside it or gone; if it is not, the fall-through below gives the same answer.
    if (g && g.ex >= unit.start && g.ex < unit.end) {
      const t = restTarget(exs, at, g);
      const same = t.to.ex === r.to.ex && t.to.set === r.to.set && t.to.name === r.to.name && t.at.i === r.at.i && t.at.name === r.at.name;
      return same ? (restLabel(exs, found, g) === r.label ? r : { ...r, label: restLabel(exs, found, g) }) : { ...t, label: restLabel(exs, found, g) };
    }
  }
  if (e && e.name === r.to.name && e.sets[r.to.set] && !e.sets[r.to.set]?.done) {
    const label = restLabel(exs, found, r.to);
    return label === r.label ? r : { ...r, label };
  }
  const i = found >= 0 ? found : r.at.i;
  const n = nextInRound(gx(exs), i, -1, (k, s) => !!exs[k]?.sets[s]?.done);
  return n && { ...restTarget(exs, i, n), label: restLabel(exs, found, n) };
}
