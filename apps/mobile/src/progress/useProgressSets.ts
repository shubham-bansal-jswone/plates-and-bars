import { useEffect, useMemo, useState } from 'react';
import { RANGE_DAYS, addDays, exInfo, overridesFromSettings, type ExType, type PrSet, type SeriesRange } from '@plate-and-bar/core';
import { loadDoneSets, type WorkoutDb } from '../db/workouts';
import { getCatalog } from '../workout/catalog';
import type { Settings } from '../settings/types';

export interface ProgressSets {
  /** Done work sets in the range, oldest first; empty until the first read finishes. */
  sets: PrSet[];
  /** Per exercise (every name in `sets`, plus the overridden ones): `exInfo(...).type`, overrides included, as core's records functions need. */
  types: Record<string, ExType>;
  loading: boolean;
  error: Error | null;
}

/**
 * The done work sets Progress needs for e1RM trends, PRs, main lifts and weekly volume, for `range` ending at `end`
 * ('all' reads everything). One query per `dataVersion`, range and end day; the result is kept until one changes.
 * The read starts in an effect, after the first paint, and never blocks it. A failed read gives `error` and the sets
 * stay as they were, so the screen can keep its non-chart content.
 */
export function useProgressSets(db: WorkoutDb, dataVersion: number, end: string, range: SeriesRange, overrides?: Settings['exercise_overrides']): ProgressSets {
  const [state, setState] = useState<{ key: string; sets: PrSet[]; error: Error | null } | null>(null);
  const key = `${dataVersion}|${range}|${end}`;
  useEffect(() => {
    let live = true;
    // `to` is the end day: sets logged after the viewed date are not part of that view.
    const from = range === 'all' ? undefined : addDays(end, -RANGE_DAYS[range]);
    loadDoneSets(db, from, end).then(
      (sets) => live && setState({ key, sets, error: null }),
      (e: unknown) => live && setState((s) => ({ key, sets: s?.sets ?? [], error: e instanceof Error ? e : new Error(String(e)) })),
    );
    return () => {
      live = false;
    };
  }, [db, key, end, range]);
  const sets = state?.sets;
  const types = useMemo(() => {
    const catalog = getCatalog();
    const o = overridesFromSettings(overrides);
    const names = new Set([...Object.keys(o), ...(sets ?? []).map((s) => s.exercise)]);
    return Object.fromEntries([...names].map((n) => [n, exInfo(n, catalog, o[n]).type] as const));
  }, [sets, overrides]);
  return { sets: sets ?? [], types, loading: state?.key !== key, error: state?.key === key ? state.error : null };
}
