import { useCallback, useEffect, useRef, useState } from 'react';
import type { CantRule } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { deleteExclusion, deleteSwap, loadExclusions, loadSwaps, saveExclusion, saveSwap, type ExclusionRecord, type SwapRecord } from '../db/rules';
import type { WorkoutDb } from '../db/workouts';
import { stamp } from './model';

export interface Rules {
  ready: boolean;
  exclusions: ExclusionRecord[];
  swaps: SwapRecord[];
}

interface Options {
  db: WorkoutDb;
  now: () => Date;
  notify: (msg: string) => void;
  /** Changes when the tab is shown again: the rules are read again (tab screens stay mounted). */
  reloadKey?: number;
}

/**
 * The saved exclusion rules and swaps. A change shows at once and its write is queued (FIFO), so nothing waits
 * on the network; removing a record writes a tombstone. Rules come from core; this only stores them.
 */
export function useRules({ db, now, notify, reloadKey = 0 }: Options) {
  const [rules, setRules] = useState<Rules>({ ready: false, exclusions: [], swaps: [] });
  const ref = useRef(rules);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const commit = useCallback((r: Rules) => {
    ref.current = r;
    setRules(r);
  }, []);

  useEffect(() => {
    let live = true;
    // Local edits still being written land first, so a reload never reads around them.
    queue.current
      .then(() => Promise.all([loadExclusions(db), loadSwaps(db)]))
      .then(([exclusions, swaps]) => live && commit({ ready: true, exclusions, swaps }))
      .catch(() => {
        notify('Couldn’t read your exercise rules.');
        if (live) commit({ ...ref.current, ready: true });
      });
    return () => {
      live = false;
    };
  }, [db, commit, notify, reloadKey]);

  const write = useCallback(
    (task: () => Promise<void>) => {
      queue.current = queue.current.then(task).catch(() => notify('Couldn’t save that. Try again.'));
    },
    [notify],
  );

  /** Stores a swap (a ladder step or side swap), replacing any earlier one from the same exercise. */
  const putSwap = useCallback(
    (s: Pick<SwapRecord, 'from' | 'to' | 'since' | 'bridge_until'>) => {
      const old = ref.current.swaps.find((x) => x.from === s.from);
      // The contract id of a swap is derived from the user at push time (sync/records.ts), so it is empty here.
      const rec: SwapRecord = { id: old?.id ?? '', version: old?.version ?? 0, updated_at: stamp(now()), deleted_at: null, ...s };
      commit({ ...ref.current, swaps: [...ref.current.swaps.filter((x) => x.from !== s.from), rec] });
      write(() => saveSwap(db, rec));
    },
    [commit, db, now, write],
  );

  /** Undoes the swap from `from`, if any. */
  const removeSwap = useCallback(
    (from: string) => {
      const old = ref.current.swaps.find((x) => x.from === from);
      if (!old) return;
      commit({ ...ref.current, swaps: ref.current.swaps.filter((x) => x !== old) });
      write(() => deleteSwap(db, old, stamp(now())));
    },
    [commit, db, now, write],
  );

  /** Saves the rule a "can't do" answer made (a permanent or timed one) and drops any swap from the same exercise. */
  const addRule = useCallback(
    (r: CantRule): ExclusionRecord => {
      const rec: ExclusionRecord = { id: newId(), version: 0, updated_at: stamp(now()), deleted_at: null, ...r };
      removeSwap(r.name);
      commit({ ...ref.current, exclusions: [...ref.current.exclusions, rec] });
      write(() => saveExclusion(db, rec));
      return rec;
    },
    [commit, db, now, removeSwap, write],
  );

  /** Replaces a rule with its changed copy (brought back, 2 more weeks, kept out). */
  const putRule = useCallback(
    (r: ExclusionRecord) => {
      const rec = { ...r, updated_at: stamp(now()) };
      commit({ ...ref.current, exclusions: ref.current.exclusions.map((x) => (x.id === r.id ? rec : x)) });
      write(() => saveExclusion(db, rec));
    },
    [commit, db, now, write],
  );

  const removeRule = useCallback(
    (id: string) => {
      const old = ref.current.exclusions.find((x) => x.id === id);
      if (!old) return;
      commit({ ...ref.current, exclusions: ref.current.exclusions.filter((x) => x !== old) });
      write(() => deleteExclusion(db, old, stamp(now())));
    },
    [commit, db, now, write],
  );

  return { rules, addRule, putRule, removeRule, putSwap, removeSwap };
}
