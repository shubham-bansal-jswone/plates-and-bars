import { useCallback, useEffect, useRef, useState } from 'react';
import { planned, waterTarget } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { loadSessionLog, loadSets, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import type { WaterLog } from './water';
import { loadWaterLogs, loadWeighIns, saveWaterLog } from './waterDb';

const stamp = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

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

  useEffect(() => {
    let live = true;
    (async () => {
      const [l, weighIns, sets, sessions] = await Promise.all([loadWaterLogs(db, date), loadWeighIns(db), loadSets(db, date), loadSessionLog(db)]);
      if (!live) return;
      logsRef.current = l;
      setLogs(l);
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
  }, [db, date, profile, notify]);

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
    const last = logsRef.current[logsRef.current.length - 1];
    if (!last) return;
    const t = stamp(now());
    const tomb = { ...last, deleted_at: t, updated_at: t };
    logsRef.current = logsRef.current.slice(0, -1);
    setLogs(logsRef.current);
    enqueue(() => saveWaterLog(db, tomb));
  }, [db, now, enqueue]);

  return { ml: logs.reduce((a, l) => a + l.ml, 0), count: logs.length, target, add, undo };
}
