import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addCycleStart, cycInfo, emptyCycle, removeLastCycleStart, type CycleData, type CycleInfo } from '@plate-and-bar/core';
import { deleteCycle, loadCycle, saveCycle } from '../db/cycle';
import type { StoreDb } from '../db/records';
import { CYCLE_DELETED, CYCLE_LOGGED, CYCLE_SAVE_FAILED } from './copy';

/**
 * The device-only cycle log for the Progress tab: read from its own local table, never queued for sync. `data` is null until read.
 * It is read again when the tab is shown and when `reloadKey` changes (a sync stored records). Each change reads the stored log
 * first, one at a time, so a log wiped meanwhile (sign-out, delete everything) is never written back from a stale copy.
 */
export function useCycle({ db, date, notify, reloadKey = 0 }: { db: StoreDb; date: string; notify: (msg: string) => void; reloadKey?: number }) {
  const [data, setData] = useState<CycleData | null>(null);
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let live = true;
    loadCycle(db)
      .then((d) => live && setData(d))
      .catch(() => live && notify(CYCLE_SAVE_FAILED));
    return () => {
      live = false;
    };
  }, [db, shown, reloadKey, notify]);

  /** `change` maps the stored log to the new one; null deletes it; undefined leaves it (the log is gone, so the screen only shows that). */
  const run = (change: (cur: CycleData) => CycleData | null | undefined, done: string | null) => {
    const step = async () => {
      try {
        const cur = await loadCycle(db);
        const next = change(cur);
        if (next === undefined) return setData(cur);
        if (next === null) await deleteCycle(db);
        else await saveCycle(db, next);
        setData(next ?? emptyCycle());
        if (done) notify(done);
      } catch {
        notify(CYCLE_SAVE_FAILED);
        setData(await loadCycle(db).catch(() => null));
      }
    };
    const p = chain.current.then(step, step);
    chain.current = p;
    return p;
  };

  return {
    data,
    /** Where the viewed date falls in the cycle; null when off, empty, or before the first start. */
    info: (data ? cycInfo(data, date) : null) as CycleInfo | null,
    turnOn: () => run((cur) => ({ ...cur, on: true }), null),
    logStart: (day: string) => run((cur) => (cur.on ? addCycleStart(cur, day) : undefined), CYCLE_LOGGED),
    removeLast: () => run((cur) => (cur.on ? removeLastCycleStart(cur) : undefined), null),
    turnOffAndDelete: () => run(() => null, CYCLE_DELETED),
  };
}
export type Cycle = ReturnType<typeof useCycle>;
