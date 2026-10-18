import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';
import type { StepReading } from '@plate-and-bar/core';

/** The Kotlin module in modules/device-steps. */
interface Native {
  isAvailableAsync(): Promise<boolean>;
  readCounterAsync(): Promise<StepReading | null>;
}

/** Null on web, iOS and any build without the module (Expo Go, jest): those keep manual entry. */
const native = (): Native | null => (Platform.OS === 'android' ? requireOptionalNativeModule<Native>('DeviceSteps') : null);

/** True when this build can read a step sensor at all (Android with the module). The phone may still have no sensor; see `stepSensorPresent`. */
export const deviceStepsSupported = (): boolean => native() !== null;

export async function stepSensorPresent(): Promise<boolean> {
  try {
    return (await native()?.isAvailableAsync()) === true;
  } catch {
    return false;
  }
}

// ACTIVITY_RECOGNITION is a runtime permission from Android 10 (API 29); before that the sensor needs none.
const needsPermission = (): boolean => Platform.OS === 'android' && Number(Platform.Version) >= 29;

export async function stepPermissionGranted(): Promise<boolean> {
  if (!needsPermission()) return true;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
  } catch {
    return false;
  }
}

/** Asks for the permission (the system dialog; `rationale` is shown first if Android wants it explained again). True when granted. */
export async function requestStepPermission(rationale: { title: string; message: string; buttonPositive: string; buttonNegative: string }): Promise<boolean> {
  if (!needsPermission()) return true;
  try {
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION, rationale)) === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/** One raw reading, or null when there is none (no sensor, no permission, no reading in a few seconds, any error). Never throws. */
export async function readStepCounter(): Promise<StepReading | null> {
  try {
    const r = await native()?.readCounterAsync();
    return r && Number.isFinite(r.counter) && Number.isFinite(r.elapsedMs) ? r : null;
  } catch {
    return null;
  }
}
