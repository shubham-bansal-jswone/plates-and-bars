import { needsClearance, num, type HealthProfile, type Where } from '@plate-and-bar/core';

// Prototype rules that packages/core does not export yet, mirrored here line for line so the screen works.
// Each moves to core with a golden test, then this file goes. TODO(#142)

/** Session modifiers and the `light` flag for set counts. Mirrors the `light` and `w.mods` steps of prototype `buildSession(t)`. */
export function sessionMods(i: { ciChoice: 'light' | 'swap' | 'orig' | null; time?: string | null; where: Where; profile: HealthProfile }) {
  const hold = i.ciChoice === 'light' || needsClearance(i.profile); // lab hold is not stored yet (always off)
  return { light: hold, short: !!i.time && i.time !== 'usual', where: i.where, deload: false, reentry: 0 };
}

/** Template name with the away-from-gym suffix. Mirrors `w.template` in prototype `buildSession(t)`. */
export const templateName = (t: string, where: Where): string => t + (where !== 'gym' ? ` (${where === 'dumbbells' ? 'dumbbells only' : 'bodyweight'})` : '');

/** Total kg lifted: sum of weight x reps over ticked sets. Mirrors the `vol` sum in prototype `renderWorkout`. */
export function volumeKg(exs: readonly { sets: readonly { done: boolean; w: string; r: string }[] }[]): number {
  let v = 0;
  for (const e of exs) for (const s of e.sets) if (s.done) v += num(s.w) * num(s.r);
  return v;
}

/** Whether "Training again later today?" shows. Mirrors the first lines of prototype `secondSessionHtml()`. */
export const secondSessionOffered = (exs: readonly { sets: readonly { done: boolean }[] }[], template: string | null): boolean =>
  exs.length > 0 && exs.every((e) => e.sets.some((s) => s.done)) && !/\+/.test(template ?? '');

/** The workout's template, base and mods after adding a second session `t`. Mirrors the merge in prototype `addSecondSession(t)`. */
export function mergeSecond(old: { template: string | null; base: string | null; mods: Record<string, unknown> }, t: string, newLight: boolean) {
  return { template: `${old.template || 'Session'} + ${t}`, base: old.base || t, mods: { ...old.mods, light: !!(old.mods.light || newLight) } };
}
