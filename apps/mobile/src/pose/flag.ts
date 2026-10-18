import { Platform } from 'react-native';
import { DEPTH_CUES, type PoseExercise } from '@plate-and-bar/core';

/** Live tracking covers the exercises core has depth cues for: adding one there is the only change needed. */
export const poseExercise = (name: string): PoseExercise | null => (Object.prototype.hasOwnProperty.call(DEPTH_CUES, name) ? (name as PoseExercise) : null);

/** A camera API exists (browsers only expose it on a secure origin). On Android the native module asks the system when the user starts, and a phone with no camera says so then. */
export const hasCamera = (): boolean => Platform.OS === 'android' || (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function');

/**
 * Whether "Track this set" shows. Off unless the build sets `EXPO_PUBLIC_POSE_TRACKING=1` (the feature flag, off by
 * default), on the web and on Android (iOS has no camera module yet), and only where a camera exists.
 * The inputs are parameters so tests can set them.
 */
export function poseAvailable(flag: string | undefined = process.env.EXPO_PUBLIC_POSE_TRACKING, os: string = Platform.OS, camera: boolean = hasCamera()): boolean {
  return flag === '1' && (os === 'web' || os === 'android') && camera;
}
