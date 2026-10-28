import type { WorkoutDb } from '../db/workouts';
import { loadWidgetData } from './data';
import { homeWidgetEnabled, WIDGET_NAME } from './flag';

/**
 * Redraws every placed widget from SQLite: on app open, after a workout write, and when the app comes back to the front.
 * Does nothing with the flag off. Local only; never throws, never blocks the caller's UI.
 */
export async function refreshHomeWidget(db: WorkoutDb, now: Date = new Date()): Promise<void> {
  if (!homeWidgetEnabled()) return;
  try {
    // Loaded only here, so a build with the flag off (and the web and iOS builds) never touches the Android-only library.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
    const { renderWorkoutWidget } = require('./WorkoutWidget') as typeof import('./WorkoutWidget');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const data = await loadWidgetData(db, now);
    await requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => renderWorkoutWidget(data) });
  } catch {
    // the widget keeps what it shows until the next refresh
  }
}
