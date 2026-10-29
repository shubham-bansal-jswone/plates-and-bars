import { useCallback, useEffect, useMemo, useState } from 'react';
import { exInfo, overridesFromSettings, type ExType, type PrSet, type SeriesRange } from '@plate-and-bar/core';
import { loadDoneSets, type WorkoutDb } from '../db/workouts';
import { getCatalog } from '../workout/catalog';
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
 * All done work sets, read once per `dataVersion` (the whole history is small, so screens filter in memory). The read
 * starts in an effect, after the first paint, and never blocks it. A failed read gives `error` and the sets stay as
 * they were, so the screen can keep its non-chart content.
 */
export function useProgressSets(db: WorkoutDb, dataVersion: number, overrides?: Settings['exercise_overrides']): ProgressSets {
  const [state, setState] = useState<{ version: number; all: PrSet[]; error: Error | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadDoneSets(db).then(
      (all) => live && setState({ version: dataVersion, all, error: null }),
      (e: unknown) => live && setState((s) => ({ version: dataVersion, all: s?.all ?? [], error: e instanceof Error ? e : new Error(String(e)) })),
    );
    return () => {
      live = false;
    };
  }, [db, dataVersion]);
  const all = useMemo(() => state?.all ?? [], [state]);
  const types = useMemo(() => {
    const catalog = getCatalog();
    const o = overridesFromSettings(overrides);
    const names = new Set([...Object.keys(o), ...all.map((s) => s.exercise)]);
    return Object.fromEntries([...names].map((n) => [n, exInfo(n, catalog, o[n]).type] as const));
  }, [all, overrides]);
  // A new `all` starts empty views.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => ({ range: new Map<string, PrSet[]>(), before: new Map<string, PrSet[]>() }), [all]);
  const inRange = useCallback(
    (end: string, range: SeriesRange) => {
      const k = `${range}|${end}`;
      let v = views.range.get(k);
      if (!v) views.range.set(k, (v = setsInRange(all, end, range)));
      return v;
    },
    [all, views],
  );
  const before = useCallback(
    (date: string) => {
      let v = views.before.get(date);
      if (!v) views.before.set(date, (v = setsBefore(all, date)));
      return v;
    },
    [all, views],
  );
  return { all, types, inRange, before, loading: state?.version !== dataVersion, error: state?.version === dataVersion ? state.error : null };
}
