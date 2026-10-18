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
 * starts with a 0 wait to put the pauses at even positions; the web (navigator.vibrate) reads it as [buzz, pause, buzz]. The non-Android
 * branch also runs on iOS, where React Native treats each entry as a pause before a fixed ~400 ms buzz, so [250, 120, 250] plays three
 * buzzes there. iOS is v2, so that pattern is left as it is for now: see issue #885.
 */
export const restDoneBuzz = (): number[] => (Platform.OS === 'android' ? [0, 250, 120, 250] : [250, 120, 250]);
/** A new personal best (prototype `checkBest`). */
export const PB_BUZZ = 60;
