import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { StoreDb } from '../db/records';
import { applyEcho, showRestNotification, takeRestNotification, type RestLike } from './rest';
import { loadReminderPrefs } from './store';

/**
 * The rest timer as a notification (#1068). While a rest runs and the app goes to the background, the Android module shows a
 * countdown to the rest's end and an alert at the end; its +30 s and Skip rest buttons change the rest through `setRest` when the
 * app is shown again. The notification goes away when the app returns, the rest or the session ends, or the screen closes.
 * Off unless "Rest timer notifications" is on (read each time the app goes to the background); follows the notification permission.
 */
export function useRestNotification<T extends RestLike>({ db, rest, setRest, sessionActive }: {
  db: StoreDb;
  rest: T | null;
  setRest: (next: (r: T | null) => T | null) => void;
  sessionActive: boolean;
}) {
  const live = useRef<T | null>(null);
  const current = sessionActive ? rest : null;
  useEffect(() => {
    live.current = current;
  }, [current]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void takeRestNotification().then((echo) => echo && setRest((r) => applyEcho(r, echo)));
        return;
      }
      const r = live.current;
      if (!r) return;
      // The setting is read now, so a change made on another tab a moment ago counts. A failed read leaves it off.
      void loadReminderPrefs(db)
        .then((p) => p.rest.on && showRestNotification(r, Date.now()))
        .then((shown) => {
          // Back in the foreground while it was being shown: take it down again.
          if (shown && AppState.currentState === 'active') void takeRestNotification();
        }, () => undefined);
    });
    return () => sub.remove();
  }, [db, setRest]);

  // A cold start finds nothing in `rest`, but a countdown and its alarm may be left from before the process died (AppState sends no
  // change on start): clear them. The echo is dropped, as there is no rest for it to change.
  useEffect(() => void takeRestNotification(), []);

  // The rest or the session ended (or the screen closed): nothing of it may stay in the shade.
  const had = useRef(false);
  const has = current !== null;
  useEffect(() => {
    if (had.current && !has) void takeRestNotification();
    had.current = has;
  }, [has]);
  useEffect(() => () => void takeRestNotification(), []);
}
