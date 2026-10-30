import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { onDayWritten } from '../workout/dayQueue';
import { homeWidgetEnabled } from './flag';
import { refreshHomeWidget } from './refresh';

const DEBOUNCE_MS = 1500;

/**
 * Renders nothing. With the home-screen widget flag on, keeps the widget current: once at app open, whenever the app returns to
 * the front, and a moment after any write to today's workout (a set ticked, a session finished or changed). The write path is
 * never delayed: the refresh runs after the write has resolved, on a timer. At midnight the platform's own update does it
 * (plugins/with-home-widget.js sets the period).
 */
export function HomeWidgetSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    if (!homeWidgetEnabled()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => void refreshHomeWidget(db);
    run();
    const app = AppState.addEventListener('change', (s) => s === 'active' && run());
    const off = onDayWritten(() => {
      clearTimeout(timer);
      timer = setTimeout(run, DEBOUNCE_MS);
    });
    return () => {
      app.remove();
      off();
      clearTimeout(timer);
    };
  }, [db]);
  return null;
}
