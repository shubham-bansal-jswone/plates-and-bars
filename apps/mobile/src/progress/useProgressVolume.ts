import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { mondayOf, plannedCoverage, volumeVsPlan, weeklyDoneSets, type MuscleSets, type VolumeVsPlanResult, type WeekPlan, type WeekSets } from '@plate-and-bar/core';
import { loadExclusions, loadSwaps } from '../db/rules';
import { loadLifts, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import { freshRead } from '../state/freshRead';
import { getCatalog } from '../workout/catalog';
import { dayQueue, dayWrites } from '../workout/dayQueue';
import type { ProgressSets } from './useProgressSets';
import { firstLogged, indexSets, loadWorkoutRows, volumeDays, type WorkoutRow } from './volumeRead';

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

interface Rows {
  workouts: WorkoutRow[];
  lifts: Awaited<ReturnType<typeof loadLifts>>;
  exclusions: Awaited<ReturnType<typeof loadExclusions>>;
  swaps: Awaited<ReturnType<typeof loadSwaps>>;
}

/**
 * Weekly done sets for the 12 weeks ending at `end`'s week. The done sets are `sets.all` (`useProgressSets`, called once by the screen); this reads
 * what the plan and the weeks need besides: every workout (all history, one query) and the lifts, exclusions and swaps. It reloads by the same
 * rules as `useProgressSets`: after the first paint, on `dataVersion`, and on a focus only when a local write happened since the last read.
 * Browsing to another day or week reads nothing: the weeks are built in memory, kept per Monday. A reload keeps the previous rows while it runs.
 * `planned` is the CURRENT plan's (`plannedCoverage` for `today`). After a failed read, `volume` is null and `error` is set: the old rows are never shown as current.
 */
export function useProgressVolume(db: WorkoutDb, sets: ProgressSets, end: string, today: string, dataVersion: number, profile: Profile | null, weekPlan: WeekPlan | undefined): { volume: ProgressVolume | null; loading: boolean; error: Error | null } {
  const [state, setState] = useState<{ rows: Rows | null; error: Error | null } | null>(null);
  const [shown, setShown] = useState(0);
  const seenFirst = useRef(false);
  const readAt = useRef<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (seenFirst.current && dayWrites.current !== readAt.current) setShown((n) => n + 1);
      seenFirst.current = true;
    }, []),
  );
  useEffect(() => {
    let live = true;
    freshRead(
      { queue: dayQueue, writes: dayWrites },
      async (): Promise<Rows> => {
        const [workouts, lifts, exclusions, swaps] = await Promise.all([loadWorkoutRows(db), loadLifts(db), loadExclusions(db), loadSwaps(db)]);
        return { workouts, lifts, exclusions, swaps };
      },
      () => live,
      (rows) => {
        readAt.current = dayWrites.current;
        setState({ rows, error: null });
      },
    ).catch((e: unknown) => {
      if (!live) return;
      readAt.current = null; // the next focus tries again, even with no write since
      setState({ rows: null, error: e instanceof Error ? e : new Error(String(e)) });
    });
    return () => {
      live = false;
    };
  }, [db, dataVersion, shown]);
  // The first sets read has finished once (a reload after it keeps the sets, so it never brings the skeleton back).
  const [setsSeen, setSetsSeen] = useState(false);
  if (!sets.loading && !setsSeen) setSetsSeen(true);
  const rows = state?.rows ?? null;
  const byDate = useMemo(() => indexSets(sets.all), [sets.all]);
  const since = useMemo(() => (rows ? firstLogged(rows.workouts) : null), [rows]);
  const planned = useMemo((): MuscleSets => {
    if (!rows || !profile) return {};
    return plannedCoverage({ date: today, profile, weekPlan, exclusions: rows.exclusions, swaps: rows.swaps, lifts: rows.lifts }, getCatalog());
  }, [rows, today, profile, weekPlan]);
  // Kept per Monday (and the sets it was built from), so moving between days of a week rebuilds nothing but the partial flag.
  const monday = mondayOf(end);
  const days = useMemo(() => (rows ? volumeDays(rows.workouts, byDate, monday, VOLUME_WEEKS) : null), [rows, byDate, monday]);
  const weeks = useMemo(() => (days ? weeklyDoneSets(days, end, VOLUME_WEEKS, getCatalog().tags) : null), [days, end]);
  const volume = useMemo((): ProgressVolume | null => (weeks ? { weeks, planned, since, result: volumeVsPlan(weeks, planned, since) } : null), [weeks, planned, since]);
  const error = state?.error ?? sets.error;
  const loading = !error && (state === null || !setsSeen);
  return { volume: error || loading ? null : volume, loading, error };
}
