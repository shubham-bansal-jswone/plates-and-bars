import { useEffect, useState, useSyncExternalStore } from 'react';
import { labHoldOn } from '@plate-and-bar/core';
import { labsVersion, loadHold, subscribeLabs } from '../db/labs';
import type { StoreDb } from '../db/records';
import { labReportsEnabled } from './flag';

/**
 * Whether the lab hold is on, for the screens that change a target or a session (Food, Workout, Targets, Progress).
 * - Always false while the feature flag is off, without reading the store.
 * - `null` means unknown: the flag is on and the first stored read has not finished. The screens that must not act on a guess
 *   (Food, which shows the target, and Workout, which can Start or add a session) show "Loading…" until it is known, so a
 *   session is never stored as normal while a hold is on. After the first read it is never null again.
 * - It reads again when a report is saved, the hold is cleared or the store is wiped. A failed read keeps the last answer; if
 *   there is none yet it reads as ON, because the hold is protective.
 */
export function useLabHold(db: StoreDb): boolean | null {
  const version = useSyncExternalStore(subscribeLabs, labsVersion);
  const [on, setOn] = useState<boolean | null>(null);
  const enabled = labReportsEnabled();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadHold(db)
      .then((h) => live && setOn(labHoldOn(h)))
      .catch(() => live && setOn((cur) => cur ?? true));
    return () => {
      live = false;
    };
  }, [db, version, enabled]);
  return enabled ? on : false;
}
