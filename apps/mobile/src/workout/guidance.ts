import { applyMods, exInfo, suggestBase, type ExInfo, type LiftRecord, type ProgressionContext, type Suggestion, type WorkoutMods } from '@plate-and-bar/core';
import type { Profile } from '../setup/types';
import { catalog } from './catalog';
import type { ExState } from './model';
import type { Workout } from './types';

/** What core reads about today, from the stored records. */
/** Progression context plus the bodyweight assisted machines need (latest logged weight, else the profile's; no weights table yet). */
export type GuidanceContext = ProgressionContext & { bodyweight: number };

export function progressionContext(date: string, lifts: Readonly<Record<string, LiftRecord>>, profile: Profile, workout: Workout | null): GuidanceContext {
  return {
    date,
    lifts,
    catalog,
    where: workout?.where ?? profile.where,
    profile,
    bodyweight: profile.weight_kg,
  };
}

/** An exercise's type, rep range and step, and its suggestion with today's modifiers applied (prototype `suggestFor`). */
export function guidance(ex: Pick<ExState, 'name' | 'bridge'>, ctx: GuidanceContext, workout: Workout | null): { info: ExInfo; sug: Suggestion } {
  const info = exInfo(ex.name, catalog, ctx.overrides?.[ex.name], ctx.where);
  const sug = applyMods(suggestBase(ex, ctx), ex, { ...ctx, mods: (workout?.mods ?? {}) as WorkoutMods, bodyweight: ctx.bodyweight });
  return { info, sug };
}
