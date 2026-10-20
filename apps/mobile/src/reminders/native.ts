import { Platform } from 'react-native';

/** One repeating reminder as the Android module keeps it. `days` are weekdays, 0 = Sunday, as in packages/core. */
export interface NativeRule {
  id: string;
  hour: number;
  minute: number;
  days: number[];
  title: string;
  body: string;
  /** A `plateandbar://` deep link opened by a tap. */
  route: string;
}

/** The rest timer the Android module shows while the app is in the background (#1068). Times are epoch milliseconds. */
export interface NativeRest {
  id: number;
  end: number;
  extendMs: number;
  title: string;
  body: string;
  doneTitle: string;
  doneBody: string;
  extendLabel: string;
  skipLabel: string;
}

/** What the notification's buttons did to the rest while the app was away. */
export interface RestEcho {
  id: number;
  end: number;
  skipped: boolean;
}

export type PermissionStatus = 'granted' | 'denied';

interface PlateRemindersModule {
  getPermissionStatus(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  setRules(rules: NativeRule[]): Promise<void>;
  cancelAll(): Promise<void>;
  showRest(rest: NativeRest): Promise<void>;
  /** Removes the rest notification and returns what its buttons did, or null when there was nothing. */
  takeRest(): Promise<RestEcho | null>;
}

/**
 * Null off Android, and in a build that does not have the module (Expo Go, tests). Read from the Expo modules global (what
 * `requireOptionalNativeModule` reads) instead of importing `expo`, which would load the whole SDK into every file that wipes the store.
 */
// Relies on expo-modules-core 58.0.x (SDK 58), which installs `globalThis.expo.modules` natively before the bundle runs. It skips
// `requireOptionalNativeModule`'s fallbacks and reads once at import time: re-check this when the SDK is upgraded.
const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
const native: PlateRemindersModule | null = Platform.OS === 'android' ? ((registry?.PlateReminders as PlateRemindersModule | undefined) ?? null) : null;

export default native;
