import { Platform } from 'react-native';

/** Must equal WIDGET_NAME in plugins/with-home-widget.js (a test compares them). */
export const WIDGET_NAME = 'TodayWorkout';

/**
 * The home-screen widget (#1181) is off until the owner turns it on, after a check on a real device. Build-time flag:
 * EXPO_PUBLIC_HOME_WIDGET=1, read by plugins/with-home-widget.js at prebuild (no widget is declared without it) and here at
 * runtime. Android only. The inputs are parameters so tests can set them.
 */
export function homeWidgetEnabled(raw: string | undefined = process.env.EXPO_PUBLIC_HOME_WIDGET, os: string = Platform.OS): boolean {
  return raw === '1' && os === 'android';
}
