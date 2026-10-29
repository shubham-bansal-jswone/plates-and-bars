import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addDays, plannedCoverage, volumeVsPlan, weeklyDoneSets, type MuscleSets, type VolumeVsPlanResult, type WeekPlan, type WeekSets } from '@plate-and-bar/core';
import { loadExclusions, loadSwaps } from '../db/rules';
import { loadLifts, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import { freshRead } from '../state/freshRead';
import { getCatalog } from '../workout/catalog';
import { dayQueue, dayWrites } from '../workout/dayQueue';
import { loadVolumeInputs, volumeFrom, type VolumeInputs } from './volumeRead';

/** Weeks the section draws. The range control offers 4 weeks, 12 weeks and All, not 8, so the chart is a fixed 12. */
export const VOLUME_WEEKS = 12;

export interface ProgressVolume {
  weeks: WeekSets[];
  /** Last-4-complete-weeks averages against the current plan. */
  result: VolumeVsPlanResult;
  /** The current plan's weekly sets (empty without a profile: setup has not run, so there is no plan). */
  planned: MuscleSets;
  since: string | null;
}

interface State {
  /** The first Monday the data covers: data for another range is never shown. */
  from: string;
  data: (VolumeInputs & { lifts: Awaited<ReturnType<typeof loadLifts>>; exclusions: Awaited<ReturnType<typeof loadExclusions>>; swaps: Awaited<ReturnType<typeof loadSwaps>> }) | null;
  error: Error | null;
}

/**
 * Weekly done sets for the 12 weeks ending at `end`'s week, read through `freshRead` after the first paint, when `dataVersion` changes,
 * when the week being viewed changes, and on a focus only when a local write happened since the last read (as `useProgressSets`).
 * `planned` is the CURRENT plan's (`plannedCoverage` for `today`), not a past one. While a read for another week runs, or after a failed read,
 * `volume` is null: the last result is never shown as current (`error` tells a failure from loading).
 */
export function useProgressVolume(db: WorkoutDb, end: string, today: string, dataVersion: number, profile: Profile | null, weekPlan: WeekPlan | undefined): { volume: ProgressVolume | null; loading: boolean; error: Error | null } {
  const [state, setState] = useState<State | null>(null);
  const [shown, setShown] = useState(0);
  const seenFirst = useRef(false);
  const readAt = useRef<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (seenFirst.current && dayWrites.current !== readAt.current) setShown((n) => n + 1);
      seenFirst.current = true;
    }, []),
  );
  const from = volumeFrom(end, VOLUME_WEEKS);
  // The read depends on the viewed week only: moving to another day of it does not read again.
  const lastMonday = addDays(from, 7 * (VOLUME_WEEKS - 1));
  useEffect(() => {
    let live = true;
    freshRead(
      { queue: dayQueue, writes: dayWrites },
      async () => {
        const [inputs, lifts, exclusions, swaps] = await Promise.all([loadVolumeInputs(db, lastMonday, VOLUME_WEEKS), loadLifts(db), loadExclusions(db), loadSwaps(db)]);
        return { ...inputs, lifts, exclusions, swaps };
      },
      () => live,
      (data) => {
        readAt.current = dayWrites.current;
        setState({ from, data, error: null });
      },
    ).catch((e: unknown) => {
      if (live) setState({ from, data: null, error: e instanceof Error ? e : new Error(String(e)) });
    });
    return () => {
      live = false;
    };
  }, [db, from, lastMonday, dataVersion, shown]);
  const same = state !== null && state.from === from ? state : null;
  const volume = useMemo((): ProgressVolume | null => {
    const d = same?.data;
    if (!d) return null;
    const catalog = getCatalog();
    const planned = profile ? plannedCoverage({ date: today, profile, weekPlan, exclusions: d.exclusions, swaps: d.swaps, lifts: d.lifts }, catalog) : {};
    const weeks = weeklyDoneSets(d.days, end, VOLUME_WEEKS, catalog.tags);
    return { weeks, planned, since: d.since, result: volumeVsPlan(weeks, planned, d.since) };
  }, [same, end, today, profile, weekPlan]);
  return { volume, loading: same === null, error: same?.error ?? null };
}
