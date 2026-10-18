import { mapForWhere, resolveSession, TEMPLATES, type Exclusion, type LiftRecord, type Swap, type Where } from '@plate-and-bar/core';
import { getCatalog } from './catalog';

/** One workout's exercise list, for picking exercises across workouts. */
export interface WorkoutList {
  name: string;
  exercises: string[];
}

/** What the lists need to apply the user's rules, as `buildSession` does. */
export interface ListRules {
  date: string;
  exclusions: readonly Exclusion[];
  swaps: readonly Swap[];
  lifts: Readonly<Record<string, LiftRecord>>;
}

/** The workouts' lists from core's templates, mapped for `where` and resolved through the user's exclusions and swaps (core `resolveSession`), so a list matches that workout's preview. */
export function workoutLists(templates: readonly string[], where: Where, rules: ListRules): WorkoutList[] {
  const catalog = getCatalog();
  return [...new Set(templates)]
    .map((name) => ({ name, exercises: resolveSession(mapForWhere([...(TEMPLATES[name] ?? [])], where, catalog), where, rules, catalog).map((i) => i.name) }))
    .filter((l) => l.exercises.length > 0);
}
