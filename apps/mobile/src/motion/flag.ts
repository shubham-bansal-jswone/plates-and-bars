/**
 * The exercise-motion player (#1069) is off until the coach has signed off real clips. Build-time flag: EXPO_PUBLIC_EXERCISE_MOTION=1,
 * and only exactly "1" turns it on. While it is off, and for any exercise without a motion entry, the v1.1 start and end figures show.
 */
export function exerciseMotionEnabled(raw: string | undefined = process.env.EXPO_PUBLIC_EXERCISE_MOTION): boolean {
  return raw === '1';
}
