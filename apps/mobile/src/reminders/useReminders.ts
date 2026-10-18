import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanProfile } from '@plate-and-bar/core';
import type { StoreDb } from '../db/records';
import native from './native';
import { DEFAULT_PREFS, type ReminderPrefs } from './schedule';
import { applySchedule } from './sync';
import { loadReminderPrefs, saveReminderPrefs } from './store';

export interface RemindersState {
  ready: boolean;
  prefs: ReminderPrefs;
  /** The system refused notifications when a reminder was switched on. */
  denied: boolean;
  saveFailed: boolean;
  /** Applies a change. Switching a reminder on first asks for the notification permission; if refused, nothing is turned on. */
  change(next: ReminderPrefs): void;
}

const KEYS = ['weigh_in', 'workout', 'lunch', 'dinner', 'water'] as const;

/**
 * The reminder choices (device-only) and their schedule. A change shows at once; the save and the hand-over to the platform
 * run in order in the background, so nothing waits on the network (there is none) or on an earlier change.
 */
export function useReminders(db: StoreDb, profile: PlanProfile | null | undefined): RemindersState {
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(prefs);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(true);
  const profileRef = useRef(profile);

  // Declared before the effects below, so they run with the current profile.
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    live.current = true;
    queue.current = queue.current.then(async () => {
      try {
        const p = await loadReminderPrefs(db);
        if (!live.current) return;
        latest.current = p;
        setPrefs(p);
        // The alarms are set again on each start, so they follow the plan and survive a wiped alarm table.
        await applySchedule(p, profileRef.current);
      } catch {
        // choices that cannot be read stay off; nothing is scheduled
      }
      if (live.current) setReady(true);
    });
    return () => {
      live.current = false;
    };
  }, [db]);

  // The workout days follow the plan.
  const days = profile?.days ?? null;
  useEffect(() => {
    if (!ready) return;
    queue.current = queue.current.then(() => applySchedule(latest.current, profileRef.current)).catch(() => undefined);
  }, [days, ready]);

  const change = useCallback(
    (next: ReminderPrefs) => {
      const before = latest.current;
      const turnsOn = KEYS.some((k) => next[k].on && !before[k].on);
      latest.current = next;
      setPrefs(next);
      queue.current = queue.current.then(async () => {
        try {
          if (turnsOn && native && (await native.requestPermission()) !== 'granted') {
            // Refused: put back what the person had, and say why.
            if (!live.current) return;
            const back = { ...latest.current };
            for (const k of KEYS) if (next[k].on && !before[k].on) back[k] = before[k] as never;
            latest.current = back;
            setPrefs(back);
            setDenied(true);
            await saveReminderPrefs(db, back);
            await applySchedule(back, profileRef.current);
            return;
          }
          if (live.current) setDenied(false);
          await saveReminderPrefs(db, latest.current);
          await applySchedule(latest.current, profileRef.current);
          if (live.current) setSaveFailed(false);
        } catch {
          if (live.current) setSaveFailed(true);
        }
      });
    },
    [db],
  );

  return { ready, prefs, denied, saveFailed, change };
}
