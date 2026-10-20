import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanProfile } from '@plate-and-bar/core';
import type { StoreDb } from '../db/records';
import { storeEpoch } from '../db/storeEpoch';
import native from './native';
import { DEFAULT_PREFS, type ReminderPrefs } from './schedule';
import { applySchedule, serial } from './sync';
import { loadReminderPrefs, saveReminderPrefs } from './store';

export interface RemindersState {
  ready: boolean;
  prefs: ReminderPrefs;
  /** The system refused notifications when a reminder was switched on. */
  denied: boolean;
  /** A reminder is on but notifications are off in the phone's settings. */
  systemOff: boolean;
  saveFailed: boolean;
  /** Applies a change. Switching a reminder on first asks for the notification permission; if refused, nothing is turned on. */
  change(next: ReminderPrefs): void;
  /** Asks the system whether notifications are allowed; call when the screen is shown. */
  recheck(): void;
}

const KEYS = ['weigh_in', 'workout', 'lunch', 'dinner', 'water', 'rest'] as const;
const anyOn = (p: ReminderPrefs) => KEYS.some((k) => p[k].on);

/**
 * The reminder choices (device-only) as the Targets tab edits them. A change shows at once; the save and the hand-over to the
 * platform run in order in the background. The schedule itself is restored at app start by `ReminderRestore`, not here.
 */
export function useReminders(db: StoreDb, profile: PlanProfile | null | undefined): RemindersState {
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  /** What the system last said about notifications; null until asked. */
  const [system, setSystem] = useState<'granted' | 'denied' | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(prefs);
  const live = useRef(true);
  const profileRef = useRef(profile);
  /** The wipe count when this screen started: a change finding another one belongs to a wiped account and must not be written. */
  const epoch = useRef(storeEpoch());
  const wiped = () => storeEpoch() !== epoch.current;

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const recheck = useCallback(() => {
    if (!native) return;
    native.getPermissionStatus().then(
      (s) => {
        if (live.current) setSystem(s === 'granted' ? 'granted' : 'denied');
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    live.current = true;
    void serial(async () => {
      try {
        const p = await loadReminderPrefs(db);
        if (!live.current) return;
        latest.current = p;
        setPrefs(p);
      } catch {
        // choices that cannot be read stay off
      }
      if (live.current) setReady(true);
    });
    return () => {
      live.current = false;
    };
  }, [db]);

  const change = useCallback(
    (next: ReminderPrefs) => {
      const before = latest.current;
      const turnsOn = KEYS.some((k) => next[k].on && !before[k].on);
      latest.current = next;
      setPrefs(next);
      void serial(async () => {
        try {
          if (turnsOn && native && (await native.requestPermission()) !== 'granted') {
            // Refused: put back what the person had, and say why.
            if (wiped()) return;
            const back = { ...latest.current };
            for (const k of KEYS) if (next[k].on && !before[k].on) back[k] = before[k] as never;
            latest.current = back;
            setPrefs(back);
            setDenied(true);
            await saveReminderPrefs(db, back);
            await applySchedule(back, profileRef.current);
            return;
          }
          if (wiped()) return; // wiped while waiting: nothing of this change may reach the new store
          setDenied(false);
          await saveReminderPrefs(db, latest.current);
          await applySchedule(latest.current, profileRef.current);
          setSaveFailed(false);
          if (turnsOn) setSystem('granted');
        } catch {
          if (live.current) setSaveFailed(true);
        }
      });
    },
    [db],
  );

  return { ready, prefs, denied, systemOff: system === 'denied' && anyOn(prefs), saveFailed, change, recheck };
}
