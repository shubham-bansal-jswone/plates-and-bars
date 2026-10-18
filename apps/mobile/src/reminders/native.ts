import { Platform, requireOptionalNativeModule } from 'expo';

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

export type PermissionStatus = 'granted' | 'denied';

interface PlateRemindersModule {
  getPermissionStatus(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  setRules(rules: NativeRule[]): Promise<void>;
  cancelAll(): Promise<void>;
}

/** Null off Android, and in a build that does not have the module (Expo Go, tests). */
const native: PlateRemindersModule | null = Platform.OS === 'android' ? requireOptionalNativeModule<PlateRemindersModule>('PlateReminders') : null;

export default native;
