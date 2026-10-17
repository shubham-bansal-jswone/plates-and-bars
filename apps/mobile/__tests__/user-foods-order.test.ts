import { loadUserFoods, saveUserFood } from '../src/db/food';
import type { UserFood } from '../src/food/types';
import { openDb } from './sync-helpers';

const food = (id: string): UserFood => ({ id, version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Dal', unit: '1 bowl', kcal: 150, protein_g: 9, carbs_g: 20, fat_g: 4, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' });
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

async function idsInserted(order: string[]): Promise<string[]> {
  const db = await openDb();
  for (const id of order) await saveUserFood(db, food(id));
  return (await loadUserFoods(db)).map((f) => f.id);
}

describe('loadUserFoods tie-break (#808)', () => {
  it('orders same-named foods with equal updated_at the same way whatever the insertion order', async () => {
    const ab = await idsInserted([A, B]);
    const ba = await idsInserted([B, A]);
    expect(ab).toEqual([A, B]);
    expect(ba).toEqual(ab);
  });
});
