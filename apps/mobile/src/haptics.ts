import { Vibration } from 'react-native';

/**
 * Vibrates the phone (prototype `navigator.vibrate`). A no-op where the device or the browser cannot, and never throws.
 * The prototype does not tie it to reduced motion (that is about movement on screen), so neither does this.
 */
export function buzz(pattern: number | number[]): void {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // no vibration motor, or no permission: nothing to do
  }
}

/** Rest timer reached 0 (prototype `tickRest`). */
export const REST_DONE_BUZZ = [250, 120, 250];
/** A new personal best (prototype `checkBest`). */
export const PB_BUZZ = 60;
