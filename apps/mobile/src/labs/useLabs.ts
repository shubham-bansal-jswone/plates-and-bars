import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { clearHold, holdAfterSave, labHoldOn, reportIsRed, type LabHold, type LabReport } from '@plate-and-bar/core';
import { exclusive } from '../db/exclusive';
import { deleteReports, labsVersion, loadHold, loadReports, notifyLabsChanged, saveHold, saveReport, subscribeLabs, type LabDb } from '../db/labs';
import { newId } from '../db/records';
import { LABS_CLEARED, LABS_DELETED, LABS_LOAD_FAILED, LABS_SAVED, LABS_SAVED_RED, LABS_SAVE_FAILED } from './copy';
import { labReportsEnabled } from './flag';

/**
 * The device-only lab reports and hold for the Progress tab, read from their own local table and never queued for sync. Saving a
 * report and setting the hold are one write (`holdAfterSave`), under the same lock the store wipe takes. Does nothing while the
 * feature flag is off. `reports` is null until read.
 */
export function useLabs({ db, today, notify, reloadKey = 0 }: { db: LabDb; today: string; notify: (msg: string) => void; reloadKey?: number }) {
  const enabled = labReportsEnabled();
  const [reports, setReports] = useState<LabReport[] | null>(null);
  const [hold, setHold] = useState<LabHold | null>(null);
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  const version = useSyncExternalStore(subscribeLabs, labsVersion);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.all([loadReports(db), loadHold(db)])
      .then(([r, h]) => {
        if (!live) return;
        setReports(r);
        setHold(h);
      })
      .catch(() => live && notify(LABS_LOAD_FAILED));
    return () => {
      live = false;
    };
  }, [db, enabled, shown, reloadKey, version, notify]);

  const run = (change: (d: LabDb) => Promise<string | null>) => {
    const step = async () => {
      try {
        let done: string | null = null;
        await exclusive(db, async (d) => {
          done = await change(d as LabDb);
        });
        notifyLabsChanged();
        if (done) notify(done);
        return true;
      } catch {
        notify(LABS_SAVE_FAILED);
        return false;
      }
    };
    const p = chain.current.then(step, step);
    chain.current = p;
    return p;
  };

  return {
    enabled,
    reports,
    holdOn: enabled && labHoldOn(hold),
    /** Saves the report (its id is made here) and starts the hold when a result is red. Resolves true when it was stored. */
    save: (r: Omit<LabReport, 'id'>) =>
      run(async (d) => {
        const report: LabReport = { ...r, id: newId() };
        await saveReport(d, report);
        const next = holdAfterSave(await loadHold(d), report, today);
        if (next) await saveHold(d, next);
        return reportIsRed(report) ? LABS_SAVED_RED : LABS_SAVED;
      }),
    /** "I've seen my doctor". */
    seenDoctor: () => run(async (d) => (await saveHold(d, clearHold()), LABS_CLEARED)),
    deleteAll: () => run(async (d) => (await deleteReports(d), LABS_DELETED)),
  };
}
export type Labs = ReturnType<typeof useLabs>;
