import eatout from '../../../content/eatout.json';
import foods from '../../../content/foods.json';
import { getFoodSources, sourceKey } from '../src/about/sources';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { getCuisines, getFoodCatalog, isCatalogFood } from '../src/food/catalog';
import { openDb } from './sync-helpers';

const LATER = '2099-01-01T00:00:00Z';
type Foods = { schema_version: number; foods: Record<string, unknown>[] };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const NEW_FOOD = { ...clone((foods as unknown as Foods).foods[0]!), name: 'Server-only test food' };

async function store(db: ContentDb, name: string, value: unknown): Promise<void> {
  await putStored(db, { name, sha256: 'x', schema_version: BUNDLED[name]!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
const newerFoods = (): Foods => ({ ...clone(foods as unknown as Foods), foods: [...clone((foods as unknown as Foods).foods), clone(NEW_FOOD)] });

describe('food catalog and sources reading the content store', () => {
  it('uses the shipped copy when nothing is stored', async () => {
    const db = await openDb();
    await loadContent(db);
    expect(getFoodCatalog()).toHaveLength(foods.foods.length);
    expect(getCuisines()).toHaveLength(eatout.cuisines.length);
    expect(getFoodCatalog()).toBe(getFoodCatalog()); // memoised
  });

  it('uses a valid newer stored copy at the next load, not before', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getFoodCatalog();
    await store(db, 'foods', newerFoods());
    expect(getFoodCatalog()).toBe(before); // stored after launch: no hot-swap
    await loadContent(db); // the next launch
    expect(getFoodCatalog().map((f) => f.name)).toContain('Server-only test food');
    expect(getFoodCatalog()).toHaveLength(foods.foods.length + 1);
  });

  it('falls back to the shipped copy for an invalid shape, without throwing', async () => {
    const db = await openDb();
    const bad = newerFoods();
    delete (bad.foods[0] as { per_serving?: unknown }).per_serving;
    const eatoutBad = { schema_version: BUNDLED.eatout!.schema_version, cuisines: 'nope' };
    await store(db, 'foods', bad);
    await store(db, 'eatout', eatoutBad);
    await loadContent(db);
    expect(getFoodCatalog()).toHaveLength(foods.foods.length);
    expect(getFoodCatalog().map((f) => f.name)).not.toContain('Server-only test food');
    expect(getCuisines()).toHaveLength(eatout.cuisines.length);
  });

  it.each([[null], [[]], ['text'], [{ foods: [] }], [{ foods: [null] }], [{ foods: [{ ...NEW_FOOD, serving: { label: 'x', grams: 'a' } }] }]])('rejects %j', async (value) => {
    const db = await openDb();
    await store(db, 'foods', value);
    await loadContent(db);
    expect(getFoodCatalog()).toHaveLength(foods.foods.length);
  });

  it('validates a shipped food row', () => {
    expect(isCatalogFood(NEW_FOOD)).toBe(true);
    expect(isCatalogFood({ ...NEW_FOOD, name: 5 })).toBe(false);
  });

  it('sources follow the stored copy when valid and stay shipped when not', async () => {
    await loadContent(await openDb()); // nothing stored: the shipped copies
    const shippedKeys = getFoodSources().map(sourceKey);
    const db = await openDb();
    const withNew = newerFoods();
    (withNew.foods[0] as { source: unknown }).source = { code: 'server_src', name: 'Server source', licence: 'CC0', url: null };
    await store(db, 'foods', withNew);
    await loadContent(db);
    expect(getFoodSources().map(sourceKey)).toContain('server_src|Server source');
    await store(db, 'foods', { schema_version: 1, foods: [{ source: { code: 1 } }] });
    await loadContent(db);
    expect(getFoodSources().map(sourceKey)).toEqual(shippedKeys);
  });
});
