import { useCallback, useEffect, useRef, useState } from 'react';
import type { CantRule } from '@plate-and-bar/core';
import { newId } from '../db/records';
import { freshRead } from '../state/freshRead';
import { deleteExclusion, deleteSwap, loadExclusions, loadSwaps, saveExclusion, saveSwap, storedVersion, type ExclusionRecord, type SwapRecord } from '../db/rules';
import type { WorkoutDb } from '../db/workouts';
import { stamp } from './model';

// One queue for every instance (the Workout and Targets tabs each hold one), so writes from both finish in the order made.
const queue: { current: Promise<unknown> } = { current: Promise.resolve() };
// Counts local rule edits (all instances), so a reload that straddled one is read again.
const writes = { current: 0 };

/** Shown when a change is refused because the stored rules could not be read (writing now could replace them). */
export const RULES_LOAD_FAILED = 'Couldn’t read your saved exercise rules, so changes are not saved. Restart the app to try again.';

export interface Rules {
  ready: boolean;
  exclusions: ExclusionRecord[];
  swaps: SwapRecord[];
  /** True when the stored rules could not be read: changes are refused, so an empty list never replaces them. */
  loadFailed: boolean;
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
  const [rules, setRules] = useState<Rules>({ ready: false, exclusions: [], swaps: [], loadFailed: false });
  const ref = useRef(rules);
  const commit = useCallback((r: Rules) => {
    ref.current = r;
    setRules(r);
  }, []);

  useEffect(() => {
    let live = true;
    // Local edits still being written land first, and a read that straddled a new edit is read again.
    freshRead({ queue, writes }, () => Promise.all([loadExclusions(db), loadSwaps(db)]), () => live, ([exclusions, swaps]) => commit({ ready: true, exclusions, swaps, loadFailed: false }))
      .catch(() => {
        notify('Couldn’t read your exercise rules.');
        if (live) commit({ ...ref.current, ready: true, loadFailed: true });
      });
    return () => {
      live = false;
    };
  }, [db, commit, notify, reloadKey]);

  /** True (with a message) when the stored rules could not be read: no change is made or written. */
  const refused = useCallback(() => {
    if (!ref.current.loadFailed) return false;
    notify(RULES_LOAD_FAILED);
    return true;
  }, [notify]);

  const write = useCallback(
    (task: () => Promise<void>) => {
      writes.current++;
      queue.current = queue.current.then(task).catch(() => notify('Couldn’t save that. Try again.'));
    },
    [notify],
  );

  /** Stores a swap (a ladder step or side swap), replacing any earlier one from the same exercise. */
  const putSwap = useCallback(
    (s: Pick<SwapRecord, 'from' | 'to' | 'since' | 'bridge_until'>) => {
      if (refused()) return;
      const old = ref.current.swaps.find((x) => x.from === s.from);
      // The contract id of a swap is derived from the user at push time (sync/records.ts), so it is empty here.
      const rec: SwapRecord = { id: old?.id ?? '', version: old?.version ?? 0, updated_at: stamp(now()), deleted_at: null, ...s };
      commit({ ...ref.current, swaps: [...ref.current.swaps.filter((x) => x.from !== s.from), rec] });
      write(async () => saveSwap(db, { ...rec, version: (await storedVersion(db, 'swaps', rec.from)) ?? rec.version }));
    },
    [commit, db, now, write, refused],
  );

  /** Undoes the swap from `from`, if any. */
  const removeSwap = useCallback(
    (from: string) => {
      if (refused()) return;
      const old = ref.current.swaps.find((x) => x.from === from);
      if (!old) return;
      commit({ ...ref.current, swaps: ref.current.swaps.filter((x) => x !== old) });
      write(async () => deleteSwap(db, { ...old, version: (await storedVersion(db, 'swaps', old.from)) ?? old.version }, stamp(now())));
    },
    [commit, db, now, write, refused],
  );

  /** Saves the rule a "can't do" answer made (a permanent or timed one) and drops any swap from the same exercise. Null when refused (rules unreadable). */
  const addRule = useCallback(
    (r: CantRule): ExclusionRecord | null => {
      if (refused()) return null;
      const rec: ExclusionRecord = { id: newId(), version: 0, updated_at: stamp(now()), deleted_at: null, ...r };
      removeSwap(r.name);
      commit({ ...ref.current, exclusions: [...ref.current.exclusions, rec] });
      write(async () => saveExclusion(db, { ...rec, version: (await storedVersion(db, 'exclusions', rec.id)) ?? rec.version }));
      return rec;
    },
    [commit, db, now, removeSwap, write, refused],
  );

  /** Replaces a rule with its changed copy (brought back, 2 more weeks, kept out). */
  const putRule = useCallback(
    (r: ExclusionRecord) => {
      if (refused()) return;
      const rec = { ...r, updated_at: stamp(now()) };
      commit({ ...ref.current, exclusions: ref.current.exclusions.map((x) => (x.id === r.id ? rec : x)) });
      write(async () => saveExclusion(db, { ...rec, version: (await storedVersion(db, 'exclusions', rec.id)) ?? rec.version }));
    },
    [commit, db, now, write, refused],
  );

  const removeRule = useCallback(
    (id: string) => {
      if (refused()) return;
      const old = ref.current.exclusions.find((x) => x.id === id);
      if (!old) return;
      commit({ ...ref.current, exclusions: ref.current.exclusions.filter((x) => x !== old) });
      write(async () => deleteExclusion(db, { ...old, version: (await storedVersion(db, 'exclusions', old.id)) ?? old.version }, stamp(now())));
    },
    [commit, db, now, write, refused],
  );

  return { rules, addRule, putRule, removeRule, putSwap, removeSwap };
}
