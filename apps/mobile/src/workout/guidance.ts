import { applyMods, exInfo, suggestBase, type ExInfo, type ProgressionContext, type Suggestion, type WorkoutMods } from '@plate-and-bar/core';
import type { Profile } from '../setup/types';
import { catalog } from './catalog';
import { liftRecord, type ExState } from './model';
import type { LiftStat, Workout } from './types';

/** What core reads about today, from the stored records. */
export function progressionContext(date: string, lifts: Readonly<Record<string, LiftStat>>, profile: Profile, workout: Workout | null): ProgressionContext {
  return {
    date,
    lifts: Object.fromEntries(Object.entries(lifts).map(([n, l]) => [n, liftRecord(l)])),
    catalog,
    where: workout?.where ?? profile.where,
    profile,
  };
}

/** An exercise's type, rep range and step, and its suggestion with today's modifiers applied (prototype `suggestFor`). */
export function guidance(ex: Pick<ExState, 'name' | 'bridge'>, ctx: ProgressionContext, workout: Workout | null): { info: ExInfo; sug: Suggestion } {
  const info = exInfo(ex.name, catalog, ctx.overrides?.[ex.name], ctx.where);
  const sug = applyMods(suggestBase(ex, ctx), ex, { ...ctx, mods: (workout?.mods ?? {}) as WorkoutMods });
  return { info, sug };
}
