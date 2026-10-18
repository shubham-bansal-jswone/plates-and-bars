import { loadUserFoods, saveUserFood } from '../src/db/food';
import { buildRecord, storeRecord } from '../src/sync/records';
import type { UserFood } from '../src/food/types';
import { openDb } from './sync-helpers';
import { EAN13 } from './barcode-fixtures';

const food = (over: Partial<UserFood> = {}): UserFood => ({
  id: '3f2b6c1e-0000-4000-8000-000000000001', version: 0, updated_at: '2026-10-19T10:00:00Z', deleted_at: null,
  name: 'Peanut bar (Acme)', unit: '1 bar (50 g)', kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 8, fibre_g: 3, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom', barcode: EAN13, ...over,
});

describe('a scanned food is an ordinary synced user food with a barcode (contract 0.1.23)', () => {
  it('saving it queues it, and the pushed record carries the barcode and origin custom', async () => {
    const db = await openDb();
    await saveUserFood(db, food());
    const queued = await db.getAllAsync<{ tbl: 'user_foods'; key: string; seq: number; queued_at: string }>("SELECT tbl, key, seq, queued_at FROM sync_outbox WHERE tbl = 'user_foods'");
    expect(queued).toHaveLength(1);
    const rec = await buildRecord(db, 'user-1', queued[0]!);
    expect(rec).toMatchObject({ id: food().id, barcode: EAN13, origin: 'custom', unit: '1 bar (50 g)' });
  });

  it('a food pulled from another device keeps its barcode, and a row from an older client has none', async () => {
    const db = await openDb();
    await storeRecord(db, 'user_foods', { ...food(), version: 3 } as never, null);
    const { barcode: _none, ...old } = food({ id: '3f2b6c1e-0000-4000-8000-000000000002', name: 'Old food' });
    await storeRecord(db, 'user_foods', { ...old, version: 1 } as never, null);
    const all = await loadUserFoods(db);
    expect(all.find((f) => f.name === 'Peanut bar (Acme)')?.barcode).toBe(EAN13);
    expect(all.find((f) => f.name === 'Old food')?.barcode).toBeUndefined();
  });
});
