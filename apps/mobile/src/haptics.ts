import { Platform, Vibration } from 'react-native';

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

/**
 * Rest timer reached 0 (prototype `tickRest`: buzz 250, pause 120, buzz 250). Android reads a pattern as [wait, buzz, pause, buzz, ...], so it
 * starts with a 0 wait to put the pauses at even positions; the web (navigator.vibrate) reads it as [buzz, pause, buzz].
 */
export const restDoneBuzz = (): number[] => (Platform.OS === 'android' ? [0, 250, 120, 250] : [250, 120, 250]);
/** A new personal best (prototype `checkBest`). */
export const PB_BUZZ = 60;
