import { useEffect, useState, useSyncExternalStore } from 'react';
import { labHoldOn } from '@plate-and-bar/core';
import { labsVersion, loadHold, subscribeLabs } from '../db/labs';
import type { StoreDb } from '../db/records';
import { labReportsEnabled } from './flag';

/**
 * Whether the lab hold is on, for the screens that change a target or a session (Food, Workout, Targets, Progress). Always false
 * while the feature flag is off, without reading the store. It reads again when a report is saved, the hold is cleared or the
 * store is wiped. A failed read keeps the last answer: it must not lift a hold by accident.
 */
export function useLabHold(db: StoreDb): boolean {
  const version = useSyncExternalStore(subscribeLabs, labsVersion);
  const [on, setOn] = useState(false);
  const enabled = labReportsEnabled();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadHold(db)
      .then((h) => live && setOn(labHoldOn(h)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [db, version, enabled]);
  return enabled && on;
}
