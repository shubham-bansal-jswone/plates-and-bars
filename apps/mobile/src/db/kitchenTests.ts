import { isKitchenTest, type KitchenTest } from '../kitchen/types';
import type { StoreDb } from './records';
import type { WorkoutDb } from './workouts';

/** Kitchen tests, last saved first (the prototype lists them in reverse save order), tombstones and rows of the wrong shape left out. */
export async function loadKitchenTests(db: WorkoutDb): Promise<KitchenTest[]> {
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM kitchen_tests');
  const out: KitchenTest[] = [];
  for (const r of rows) {
    try {
      const x: unknown = JSON.parse(r.data);
      if (isKitchenTest(x) && !x.deleted_at) out.push(x);
    } catch {
      // not JSON: skipped like any other damaged row
    }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveKitchenTest(db: StoreDb, t: KitchenTest): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO kitchen_tests (key, data) VALUES (?, ?)', t.id, JSON.stringify(t));
}
