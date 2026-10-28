import { openDatabaseAsync } from 'expo-sqlite';
import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { DB_NAME } from '../db/migrations';
import { loadWidgetData } from './data';
import { renderWorkoutWidget } from './WorkoutWidget';

/**
 * The widget's lifecycle events, run by the library in a headless JS task (the app may not be open). Added, resized and the
 * 30-minute platform update all redraw from SQLite; a tap is an OPEN_URI the library handles natively, and nothing else needs work.
 */
export async function widgetTaskHandler({ widgetAction, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_CLICK' || widgetAction === 'WIDGET_DELETED') return;
  let db: Awaited<ReturnType<typeof openDatabaseAsync>> | null = null;
  try {
    db = await openDatabaseAsync(DB_NAME);
    renderWidget(renderWorkoutWidget(await loadWidgetData(db)));
  } catch {
    // no database yet: the widget keeps what it shows
  } finally {
    await db?.closeAsync().catch(() => undefined);
  }
}

/** Called once from index.js, and only when the flag is on. */
export const registerHomeWidget = (): void => registerWidgetTaskHandler(widgetTaskHandler);
