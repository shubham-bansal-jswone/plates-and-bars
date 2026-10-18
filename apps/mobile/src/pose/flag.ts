import { Platform } from 'react-native';
import type { PoseExercise } from '@plate-and-bar/core';

/** The exercises live tracking has a count, depth and tempo for (slice 1 of #947). Machine squats and everything else are left out. */
const POSE_EXERCISES: readonly string[] = ['Bodyweight Squat', 'Goblet Squat'];

export const poseExercise = (name: string): PoseExercise | null => (POSE_EXERCISES.includes(name) ? (name as PoseExercise) : null);

/** A camera API exists (browsers only expose it on a secure origin). */
export const hasCamera = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * Whether "Track this set" shows. Off unless the build sets `EXPO_PUBLIC_POSE_TRACKING=1` (the feature flag, off by
 * default), on the web only (the Android camera module is a separate change), and only where a camera exists.
 * The inputs are parameters so tests can set them.
 */
export function poseAvailable(flag: string | undefined = process.env.EXPO_PUBLIC_POSE_TRACKING, os: string = Platform.OS, camera: boolean = hasCamera()): boolean {
  return flag === '1' && os === 'web' && camera;
}
