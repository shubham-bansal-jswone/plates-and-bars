import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { planned, waterTarget, type WeekPlan } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { loadSessionLog, loadSets, type WorkoutDb } from '../db/workouts';
import type { Profile } from '../setup/types';
import type { WaterLog } from './water';
import { loadWeights } from '../db/progress';
import { loadWaterLogs, saveWaterLog } from './waterDb';
import { freshRead } from '../state/freshRead';
import { dayQueue, dayWrites } from '../workout/dayQueue';

// Keeps the milliseconds: `updated_at` is what orders the day's drinks, so two taps in one second stay in order.
const stamp = (d: Date): string => d.toISOString();

interface Options {
  db: WorkoutDb;
  date: string;
  now: () => Date;
  profile: Profile | null;
  /** Settings `adjustments`: the week plan and sequence mode decide today's planned session. */
  adjustments?: Readonly<Record<string, unknown>>;
  notify: (msg: string) => void;
  /** Changes when sync stored pulled records: the drinks and the target are read again (after queued local writes). */
  reloadKey?: number;
}

/**
 * Today's water: each tap shows at once and its write goes through one FIFO queue, like food logs. Undo
 * tombstones the last drink. The target is core's `waterTarget` over the weigh-ins, ticked sets and plan.
 */
export function useWater({ db, date, now, profile, adjustments, notify, reloadKey = 0 }: Options) {
  const [logs, setLogs] = useState<WaterLog[]>([]);
  const [target, setTarget] = useState<{ ml: number; trained: boolean } | null>(null);
  const logsRef = useRef(logs);
  /** The day the shown drinks belong to: not ready while the viewed day is another one, so Undo cannot tombstone another day's drink. */
  const [loaded, setLoaded] = useState<string | null>(null);
  /** A read failed and nothing has been read yet: the card is not held in place any longer. */
  const [failed, setFailed] = useState(false);
  const loadedRef = useRef<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Counts this screen's writes, so a read that overlapped one is redone. */
  const writes = useRef(0);

  // Tab screens stay mounted, so the target is read again each time the tab is shown (a set ticked or a weigh-in
  // added elsewhere changes it), as in src/targets/sections.tsx.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));

  useEffect(() => {
    let live = true;
    (async () => {
      await freshRead({ queue, writes }, () => loadWaterLogs(db, date), () => live, (l) => {
        logsRef.current = l;
        setLogs(l);
        loadedRef.current = date;
        setLoaded(date);
      });
    })().catch(() => {
      if (live) {
        setFailed(true);
        notify('Couldn’t read your saved water.');
      }
    });
    return () => {
      live = false;
    };
  }, [db, date, notify, reloadKey]);

  useEffect(() => {
    let live = true;
    (async () => {
      // The ticked sets come from the Workout tab's writes, so the read waits for that queue too. Weights saved by the
      // Progress hook's queue are not awaited: a just-logged weight reaches the target on the next focus or pull.
      await freshRead(
        { queue: dayQueue, writes: dayWrites },
        () => Promise.all([loadWeights(db), loadSets(db, date), loadSessionLog(db)]),
        () => live,
        ([weighIns, sets, sessions]) =>
          setTarget(
            waterTarget({
              date,
              weighIns,
              profileWeightKg: profile?.weight_kg,
              anySetDone: sets.some((s) => s.done && !s.deleted_at),
              planned: planned(date, { profile, sessions, weekPlan: adjustments?.weekPlan as WeekPlan | undefined, mode: adjustments?.mode as string | undefined }),
            }),
          ),
      );
    })().catch(() => {
      if (live) {
        setFailed(true);
        notify('Couldn’t read your saved water.');
      }
    });
    return () => {
      live = false;
    };
  }, [db, date, profile, adjustments, notify, shown, reloadKey]);

  const enqueue = useCallback(
    (write: () => Promise<void>) => {
      writes.current++;
      queue.current = queue.current.then(write).catch(() => notify('Couldn’t save that. Try again.'));
    },
    [notify],
  );

  const add = useCallback(
    (ml: number) => {
      if (loadedRef.current !== date) return;
      const t = stamp(now());
      const log: WaterLog = { id: newId(), version: 0, updated_at: t, deleted_at: null, date, ml };
      logsRef.current = [...logsRef.current, log];
      setLogs(logsRef.current);
      enqueue(() => saveWaterLog(db, log));
    },
    [db, date, now, enqueue],
  );

  const undo = useCallback(() => {
    if (loadedRef.current !== date) return;
    // The newest drink by its own timestamp, not by row or array position, so a sync rewrite cannot change which is undone.
    const last = logsRef.current.reduce<WaterLog | null>((a, l) => (!a || Date.parse(l.updated_at) >= Date.parse(a.updated_at) ? l : a), null);
    if (!last) return;
    const t = stamp(now());
    const tomb = { ...last, deleted_at: t, updated_at: t };
    logsRef.current = logsRef.current.filter((l) => l.id !== last.id);
    setLogs(logsRef.current);
    enqueue(() => saveWaterLog(db, tomb));
  }, [db, date, now, enqueue]);

  return { failed, ready: loaded === date, ml: logs.reduce((a, l) => a + l.ml, 0), count: logs.length, target, add, undo };
}
