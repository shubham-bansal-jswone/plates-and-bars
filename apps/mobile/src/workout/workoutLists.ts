import { mapForWhere, TEMPLATES, type Where } from '@plate-and-bar/core';
import { getCatalog } from './catalog';

/** One workout's exercise list, for picking exercises across workouts (the lists come from core's templates, mapped for `where`). */
export interface WorkoutList {
  name: string;
  exercises: string[];
}

export function workoutLists(templates: readonly string[], where: Where): WorkoutList[] {
  return [...new Set(templates)].map((name) => ({ name, exercises: mapForWhere([...(TEMPLATES[name] ?? [])], where, getCatalog()) })).filter((l) => l.exercises.length > 0);
}
