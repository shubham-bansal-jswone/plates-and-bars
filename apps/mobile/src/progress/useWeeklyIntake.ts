import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressDay } from '@plate-and-bar/core';
import { loadLogsBetween } from '../db/food';
import type { WorkoutDb } from '../db/workouts';
import { freshRead } from '../state/freshRead';
import { dayQueue, dayWrites } from '../workout/dayQueue';
import { daysFromLogs, eatingFrom } from './eatingLogic';

interface Options {
  db: WorkoutDb;
  /** The viewed day: the 12 weeks end with its week, as the check-in's 21 days end on it. */
  date: string;
  /** Pass the same value as `useCheckin`'s `reloadKey`. */
  reloadKey?: number;
}

/**
 * Food logs of the 12 weeks ending with `date`'s week, in one read. `useCheckin` only reads 21 days (and 7 for the current week), so it
 * cannot feed 12 weeks; this reads the same table the same way and reloads on the same triggers: each focus of the tab, a new `reloadKey`
 * (sync pulled records) and a new date, through `freshRead` after queued workout writes. `days` is null while the days of `date` are read;
 * `failed` is true after a failed read of `date` (until a later read succeeds), and then the card shows the error, not the older days.
 */
export function useWeeklyIntake({ db, date, reloadKey = 0 }: Options): { days: ProgressDay[] | null; failed: boolean } {
  const [read, setRead] = useState<{ date: string; days: ProgressDay[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  // The tab stays mounted, so the days are read again each time it is shown, but not on the first show: the mount already reads.
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false;
      else setShown((n) => n + 1);
    }, []),
  );
  useEffect(() => {
    let live = true;
    freshRead({ queue: dayQueue, writes: dayWrites }, () => loadLogsBetween(db, eatingFrom(date), date), () => live, (logs) => {
      setRead({ date, days: daysFromLogs(logs) });
      setFailed(null);
    }).catch(() => {
      if (live) setFailed(date);
    });
    return () => {
      live = false;
    };
  }, [db, date, shown, reloadKey]);
  return { days: read && read.date === date ? read.days : null, failed: failed === date };
}
