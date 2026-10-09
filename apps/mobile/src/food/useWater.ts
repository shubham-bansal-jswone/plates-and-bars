import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { planned, waterTarget } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { loadSessionLog, loadSets, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import type { WaterLog } from './water';
import { loadWaterLogs, loadWeighIns, saveWaterLog } from './waterDb';

// Keeps the milliseconds: `updated_at` is what orders the day's drinks, so two taps in one second stay in order.
const stamp = (d: Date): string => d.toISOString();

interface Options {
  db: WorkoutDb;
  date: string;
  now: () => Date;
  profile: Profile | null;
  notify: (msg: string) => void;
}

/**
 * Today's water: each tap shows at once and its write goes through one FIFO queue, like food logs. Undo
 * tombstones the last drink. The target is core's `waterTarget` over the weigh-ins, ticked sets and plan.
 */
export function useWater({ db, date, now, profile, notify }: Options) {
  const [logs, setLogs] = useState<WaterLog[]>([]);
  const [target, setTarget] = useState<{ ml: number; trained: boolean } | null>(null);
  const logsRef = useRef(logs);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Tab screens stay mounted, so the target is read again each time the tab is shown (a set ticked or a weigh-in
  // added elsewhere changes it), as in src/targets/sections.tsx.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));

  useEffect(() => {
    let live = true;
    (async () => {
      const l = await loadWaterLogs(db, date);
      if (!live) return;
      logsRef.current = l;
      setLogs(l);
    })().catch(() => {
      if (live) notify('Couldn’t read your saved water.');
    });
    return () => {
      live = false;
    };
  }, [db, date, notify]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [weighIns, sets, sessions] = await Promise.all([loadWeighIns(db), loadSets(db, date), loadSessionLog(db)]);
      if (!live) return;
      setTarget(
        waterTarget({
          date,
          weighIns,
          profileWeightKg: profile?.weight_kg,
          anySetDone: sets.some((s) => s.done && !s.deleted_at),
          planned: planned(date, { profile, sessions }),
        }),
      );
    })().catch(() => {
      if (live) notify('Couldn’t read your saved water.');
    });
    return () => {
      live = false;
    };
  }, [db, date, profile, notify, shown]);

  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      queue.current = queue.current.then(write).catch(() => notify('Couldn’t save that. Try again.'));
    },
    [notify],
  );

  const add = useCallback(
    (ml: number) => {
      const t = stamp(now());
      const log: WaterLog = { id: newId(), version: 0, updated_at: t, deleted_at: null, date, ml };
      logsRef.current = [...logsRef.current, log];
      setLogs(logsRef.current);
      enqueue(() => saveWaterLog(db, log));
    },
    [db, date, now, enqueue],
  );

  const undo = useCallback(() => {
    // The newest drink by its own timestamp, not by row or array position, so a sync rewrite cannot change which is undone.
    const last = logsRef.current.reduce<WaterLog | null>((a, l) => (!a || l.updated_at >= a.updated_at ? l : a), null);
    if (!last) return;
    const t = stamp(now());
    const tomb = { ...last, deleted_at: t, updated_at: t };
    logsRef.current = logsRef.current.filter((l) => l.id !== last.id);
    setLogs(logsRef.current);
    enqueue(() => saveWaterLog(db, tomb));
  }, [db, now, enqueue]);

  return { ml: logs.reduce((a, l) => a + l.ml, 0), count: logs.length, target, add, undo };
}
