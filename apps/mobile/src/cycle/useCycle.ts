import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { addCycleStart, cycInfo, emptyCycle, removeLastCycleStart, type CycleData, type CycleInfo } from '@plate-and-bar/core';
import { deleteCycle, loadCycle, saveCycle } from '../db/cycle';
import type { StoreDb } from '../db/records';
import { CYCLE_DELETED, CYCLE_LOGGED, CYCLE_SAVE_FAILED } from './copy';

/**
 * The device-only cycle log for the Progress tab: read from its own local table, written back on each change, never queued for sync.
 * `data` is null until read. The log is read again when the tab is shown, so a wipe elsewhere clears it here.
 */
export function useCycle({ db, date, notify }: { db: StoreDb; date: string; notify: (msg: string) => void }) {
  const [data, setData] = useState<CycleData | null>(null);
  const latest = useRef<CycleData | null>(null);
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));

  useEffect(() => {
    let live = true;
    loadCycle(db)
      .then((d) => {
        if (!live) return;
        latest.current = d;
        setData(d);
      })
      .catch(() => live && notify(CYCLE_SAVE_FAILED));
    return () => {
      live = false;
    };
  }, [db, shown, notify]);

  // Each change builds on the latest value, so two quick taps both count; a failed write puts the stored value back.
  const apply = async (next: CycleData, done: string | null, write: () => Promise<void>) => {
    const before = latest.current;
    latest.current = next;
    setData(next);
    try {
      await write();
      if (done) notify(done);
    } catch {
      latest.current = before;
      setData(before);
      notify(CYCLE_SAVE_FAILED);
    }
  };

  const base = () => latest.current ?? emptyCycle();
  return {
    data,
    /** Where the viewed date falls in the cycle; null when off, empty, or before the first start. */
    info: (data ? cycInfo(data, date) : null) as CycleInfo | null,
    turnOn: () => {
      const next = { ...base(), on: true };
      return apply(next, null, () => saveCycle(db, next));
    },
    logStart: (day: string) => {
      const next = addCycleStart(base(), day);
      return apply(next, CYCLE_LOGGED, () => saveCycle(db, next));
    },
    removeLast: () => {
      const next = removeLastCycleStart(base());
      return apply(next, null, () => saveCycle(db, next));
    },
    turnOffAndDelete: () => apply(emptyCycle(), CYCLE_DELETED, () => deleteCycle(db)),
  };
}
export type Cycle = ReturnType<typeof useCycle>;
