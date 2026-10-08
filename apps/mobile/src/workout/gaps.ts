import { COMPOUND, planList, snap, type ExInfo, type PlanProfile } from '@plate-and-bar/core';
import { catalog } from './catalog';

// Three prototype rules that packages/core does not export yet. They are mirrored here, line for line, so the
// screen works; each should move to core with a golden test and this file then shrinks to re-exports.
// TODO(core): `restFor(name)` (prototype `restFor`), `warmupSets(...)` (`warmupHtml`), `nextInList(t)` (`nextInList`),
// `checkinFlags(ci)` (the `flagged` step of `renderStart`).

/** Rest between sets in seconds. Mirrors prototype `restFor(name)`. */
export function restFor(name: string): number {
  const t = catalog.tags[name];
  return t && COMPOUND.has(t.pattern) ? 150 : 75;
}

/** Label for `restFor`. Mirrors prototype `restLabel`. */
export const restLabel = (name: string): string => (restFor(name) >= 150 ? '2–3 min' : '60–90 sec');

/** The template after `t` in the plan. Mirrors prototype `nextInList(t)`. */
export function nextInList(t: string, profile: PlanProfile | null): string | null {
  const L = planList(profile);
  if (!L.length) return null;
  return L[(L.indexOf(t) + 1) % L.length] ?? null;
}

/** Two warm-up weights (50% and 75% of the first compound lift's suggestion). Mirrors prototype `warmupHtml`'s numbers. */
export function warmupWeights(sugW: number, info: ExInfo): [number, number] {
  return [Math.max(0, snap(sugW * 0.5, info.step || 2.5)), Math.max(0, snap(sugW * 0.75, info.step || 2.5))];
}

/** Why the check-in suggests a lighter session, or `[]` when it does not. Mirrors the `flagged` step of prototype `renderStart()`. */
export function checkinFlags(ci: { sleep?: string; sore?: string; energy?: string }): string[] {
  return [ci.sleep === 'poor' && 'poor sleep', ci.energy === 'low' && 'low energy', ci.sore === 'very' && 'very sore muscles'].filter((x): x is string => !!x);
}
