import type { WorkoutDb } from '../db/workouts';

/** Web and iOS have no home-screen widget: nothing to redraw. The Android version is `refresh.android.ts`. */
export async function refreshHomeWidget(_db: WorkoutDb, _now?: Date): Promise<void> {}
