import type { WorkoutDb } from '../db/workouts';
import { loadWidgetData } from './data';
import { homeWidgetEnabled, WIDGET_NAME } from './flag';
import { renderWorkoutWidget } from './WorkoutWidget';

/**
 * Redraws every placed widget from SQLite: on app open, after a workout write, and when the app comes back to the front.
 * Does nothing with the flag off, and keeps what the widget shows when SQLite cannot be read. Local only; never throws, never
 * blocks the caller's UI. Android only: `refresh.ts` is the no-op the other platforms get, so the library stays out of their bundles.
 */
export async function refreshHomeWidget(db: WorkoutDb, now: Date = new Date()): Promise<void> {
  if (!homeWidgetEnabled()) return;
  try {
    // Loaded only with the flag on: a flag-off build never looks up the library's native module at start.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
    const data = await loadWidgetData(db, now);
    if (data) await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => renderWorkoutWidget(data) });
  } catch {
    // the widget keeps what it shows until the next refresh
  }
}
