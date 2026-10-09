import { isRecipe, type Recipe } from '../recipes/types';
import type { StoreDb } from './records';
import type { WorkoutDb } from './workouts';

/** Saved recipes, newest first, tombstones and rows of the wrong shape left out. */
export async function loadRecipes(db: WorkoutDb): Promise<Recipe[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM recipes');
  const out: Recipe[] = [];
  for (const r of rows) {
    try {
      const x: unknown = JSON.parse(r.data);
      if (isRecipe(x) && !x.deleted_at) out.push(x);
    } catch {
      // not JSON: skipped like any other damaged row
    }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.name.localeCompare(b.name));
}

export async function saveRecipe(db: StoreDb, r: Recipe): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO recipes (key, data) VALUES (?, ?)', r.id, JSON.stringify(r));
}
