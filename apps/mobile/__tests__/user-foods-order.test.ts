import { loadUserFoods, saveUserFood } from '../src/db/food';
import type { UserFood } from '../src/food/types';
import { openDb } from './sync-helpers';

const food = (id: string): UserFood => ({ id, version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Dal', unit: '1 bowl', kcal: 150, protein_g: 9, carbs_g: 20, fat_g: 4, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' });
const A = 'aa000000-0000-4000-8000-000000000001';
const B = 'ab000000-0000-4000-8000-000000000002';

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

  it('breaks the id tie by code unit, so a locale that sorts "aa" after "ab" (da, nb) does not change the order', async () => {
    const orig = String.prototype.localeCompare;
    // Stand-in for a da/nb device: the locale-aware compare disagrees with code-unit order.
    String.prototype.localeCompare = function (this: string, that: string) { return -orig.call(this, that); };
    try {
      const ab = await idsInserted([A, B]);
      const ba = await idsInserted([B, A]);
      expect(ab).toEqual([A, B]);
      expect(ba).toEqual([A, B]);
      expect([A, B].sort((x, y) => x.localeCompare(y))).toEqual([B, A]);
    } finally {
      String.prototype.localeCompare = orig;
    }
  });
});
