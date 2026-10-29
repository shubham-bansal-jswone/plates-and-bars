import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { exInfo, overridesFromSettings, type ExType, type PrSet, type SeriesRange } from '@plate-and-bar/core';
import { loadDoneSets, type WorkoutDb } from '../db/workouts';
import { getCatalog } from '../workout/catalog';
import { freshRead } from '../state/freshRead';
import { dayQueue, dayWrites } from '../workout/dayQueue';
import type { Settings } from '../settings/types';
import { setsBefore, setsInRange } from './setsView';

export interface ProgressSets {
  /** All done work sets, oldest first; empty until the first read finishes. PRs (`personalRecords`, `priorBestOf`) and `mainLifts` read this, never a range slice. */
  all: PrSet[];
  /** Per exercise (every name in `all`, plus the overridden ones): `exInfo(...).type`, overrides included, as core's records functions need. */
  types: Record<string, ExType>;
  /** `setsInRange(all, end, range)`, kept per end and range, so browsing days or ranges never reads the db. */
  inRange: (end: string, range: SeriesRange) => PrSet[];
  /** `setsBefore(all, date)`, kept per date. */
  before: (date: string) => PrSet[];
  loading: boolean;
  error: Error | null;
}

/**
 * All done work sets, read through `freshRead` (after queued local writes) when the screen is first shown, on a
 * focus after a local write, and when `dataVersion` changes. Pass `useDataVersion()` as `dataVersion` and nothing else (not the steps
 * version: step readings must not re-read every set). Focus reload keeps a set ticked on Workout visible on Progress,
 * and a build without a SyncProvider (dataVersion stays 0) still reloads. A focus reloads only when a local write (the day write counter) happened since the last read; sync pulls and restore reload through `dataVersion`. The read starts in an effect, after first paint.
 *
 * `all` keeps the previous result while a reload runs (`loading` is true) and after a failed read (`error` is set).
 * The consumer (A4) must show the error state and not present those sets as current. For assisted lifts A4 passes the
 * bodyweight to `personalRecords` itself (it reads it with the weigh-ins); it is not part of this hook, which only reads sets.
 */
export function useProgressSets(db: WorkoutDb, dataVersion: number, overrides?: Settings['exercise_overrides']): ProgressSets {
  const [state, setState] = useState<{ read: string; all: PrSet[]; error: Error | null } | null>(null);
  const [shown, setShown] = useState(0);
  const seenFirst = useRef(false);
  // The write count of the last applied read; a failed read leaves it, so the next focus tries again.
  const readAt = useRef<number | null>(null);
  // useFocusEffect also fires on mount, where the effect below already reads. A later focus reads again only after a local write since the last read.
  useFocusEffect(
    useCallback(() => {
      if (seenFirst.current && dayWrites.current !== readAt.current) setShown((n) => n + 1);
      seenFirst.current = true;
    }, []),
  );
  const read = `${dataVersion}|${shown}`;
  useEffect(() => {
    let live = true;
    freshRead({ queue: dayQueue, writes: dayWrites }, () => loadDoneSets(db), () => live, (all) => {
      readAt.current = dayWrites.current;
      setState({ read, all, error: null });
    }).catch((e: unknown) => {
      if (live) setState((s) => ({ read, all: s?.all ?? [], error: e instanceof Error ? e : new Error(String(e)) }));
    });
    return () => {
      live = false;
    };
  }, [db, read]);
  const all = useMemo(() => state?.all ?? [], [state]);
  const types = useMemo(() => {
    const catalog = getCatalog();
    const o = overridesFromSettings(overrides);
    const names = new Set([...Object.keys(o), ...all.map((s) => s.exercise)]);
    return Object.fromEntries([...names].map((n) => [n, exInfo(n, catalog, o[n]).type] as const));
  }, [all, overrides]);
  // A new `all` starts with empty views, so a reload never serves an old slice.
  const { inRange, before } = useMemo(() => {
    const ranges = new Map<string, PrSet[]>();
    const befores = new Map<string, PrSet[]>();
    return {
      inRange: (end: string, range: SeriesRange): PrSet[] => {
        const k = `${range}|${end}`;
        let v = ranges.get(k);
        if (!v) ranges.set(k, (v = setsInRange(all, end, range)));
        return v;
      },
      before: (date: string): PrSet[] => {
        let v = befores.get(date);
        if (!v) befores.set(date, (v = setsBefore(all, date)));
        return v;
      },
    };
  }, [all]);
  return { all, types, inRange, before, loading: state?.read !== read, error: state?.read === read ? state.error : null };
}
