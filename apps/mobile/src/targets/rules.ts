import type { WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import type { Settings } from '../settings/types';

/** One muscle's weekly sets: planned from the plan, done from logged work sets. */
export interface CoverageRow {
  muscle: string;
  planned: number;
  done: number;
  /** Core's "under target" flag for the planned figure, so the screen holds no threshold. */
  low: boolean;
}

/**
 * What the Targets screen needs from packages/core for focus muscles and weekly coverage. Core does not
 * export these rules yet (issue #148: `weeklyCoverage` and the focus rules), so the app does not have them either:
 * the screen takes them as this type and shows neither section while `targetsRules` is null.
 */
export interface TargetsRules {
  /** Muscles offered as focus, in display order (prototype `COVER_SHOW`). */
  focusChoices: readonly string[];
  /** The most focus muscles at a time, for the limit message only. */
  focusMax: number;
  /** Focus after toggling `muscle`, or null when core refuses (limit reached). */
  toggleFocus(current: readonly string[], muscle: string): readonly string[] | null;
  /** Weekly planned vs done per muscle, for `today` (`YYYY-MM-DD`). */
  coverage(input: { db: WorkoutDb; profile: Profile; settings: Settings; today: string }): Promise<CoverageRow[]>;
}

/**
 * TODO(#148): build this from core's exports once they land (merge main, then map `weeklyCoverage` and the
 * focus rules to `TargetsRules`). Until then there is nothing to show.
 */
export const targetsRules: TargetsRules | null = null;
