import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

/**
 * Vibrates the phone (prototype `navigator.vibrate`). A no-op where the device or the browser cannot, and never throws.
 * The prototype does not tie it to reduced motion (that is about movement on screen), so neither does this.
 */
export function buzz(pattern: number | number[]): void {
  try {
    // iOS: React Native plays a fixed ~400 ms buzz per pattern entry and ignores the durations (#885), so a pattern becomes one system "success" haptic (two taps).
    if (Platform.OS === 'ios' && typeof pattern !== 'number') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return;
    }
    Vibration.vibrate(pattern);
  } catch {
    // no vibration motor, or no permission: nothing to do
  }
}

/**
 * Rest timer reached 0 (prototype `tickRest`: buzz 250, pause 120, buzz 250). Android reads a pattern as [wait, buzz, pause, buzz, ...], so it
 * starts with a 0 wait to put the pauses at even positions; the web (navigator.vibrate) reads it as [buzz, pause, buzz]. On iOS `buzz` ignores the
 * durations and plays one system haptic (#885).
 */
export const restDoneBuzz = (): number[] => (Platform.OS === 'android' ? [0, 250, 120, 250] : [250, 120, 250]);
/** A new personal best (prototype `checkBest`). */
export const PB_BUZZ = 60;
/** Cook-mode timer done: buzz 300, pause 150, buzz 300, shaped like `restDoneBuzz` per platform (#873). */
export const cookDoneBuzz = (): number[] => (Platform.OS === 'android' ? [0, 300, 150, 300] : [300, 150, 300]);
