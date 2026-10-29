import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { LiftRecord } from '@plate-and-bar/core';
import { loadLifts, loadSessionLog, loadSets, loadWorkout, type WorkoutDb } from '../../db/workouts';
import { freshRead } from '../../state/freshRead';
import { dayQueue, dayWrites } from '../../workout/dayQueue';
import { buildSessions, recentDates, type HistorySession } from './logic';

/** Read-only workout history from the stored workouts, sets and lift records. `null` sessions while loading. */
export function useHistory(db: WorkoutDb, reloadKey: number) {
  const [state, setState] = useState<{ sessions: HistorySession[]; lifts: Record<string, LiftRecord> } | null>(null);
  // Tab screens stay mounted, so the history is read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  useEffect(() => {
    let live = true;
    freshRead(
      { queue: dayQueue, writes: dayWrites },
      async () => {
        const log = await loadSessionLog(db);
        const sets = Object.fromEntries(await Promise.all(recentDates(log).map(async (d) => [d, await loadSets(db, d)] as const)));
        const stored = Object.fromEntries(await Promise.all(recentDates(log).map(async (d) => [d, await loadWorkout(db, d)] as const)));
        const cardio = Object.fromEntries(Object.entries(stored).map(([d, w]) => [d, w?.cardio_min ?? null] as const));
        const groups = Object.fromEntries(Object.entries(stored).map(([d, w]) => [d, w?.exercises ?? []] as const));
        return { sessions: buildSessions(log, sets, cardio, groups), lifts: await loadLifts(db) };
      },
      () => live,
      setState,
    ).catch(() => undefined); // unreadable: the section stays hidden, never a false "nothing logged"
    return () => {
      live = false;
    };
  }, [db, shown, reloadKey]);
  return state;
}
