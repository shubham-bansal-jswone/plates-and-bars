import eatout from '../../../content/eatout.json';
import foods from '../../../content/foods.json';
import { getFoodSources, sourceKey } from '../src/about/sources';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { contentReader } from '../src/content/reader';
import { putStored, type ContentDb } from '../src/content/store';
import { getCuisines, getFoodCatalog, isCatalogFood } from '../src/food/catalog';
import { openDb } from './sync-helpers';

const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shippedFoods = foods as unknown as Obj;
const shippedEatout = eatout as unknown as Obj;
const UUID = '11111111-2222-4333-8444-555555555555';

async function store(db: ContentDb, name: string, value: unknown): Promise<void> {
  await putStored(db, { name, sha256: 'x', schema_version: BUNDLED[name]!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
async function launch(stored: Record<string, unknown> = {}): Promise<void> {
  const db = await openDb();
  for (const [n, v] of Object.entries(stored)) await store(db, n, v);
  await loadContent(db);
}
const newFood = (over: Obj = {}): Obj => ({ ...clone(shippedFoods.foods[0]), id: UUID, name: 'Server-only test food', ...over });
const foodsWith = (mutate: (b: Obj) => void): Obj => { const b = clone(shippedFoods); b.foods.push(newFood()); mutate(b); return b; };
const eatoutWith = (mutate: (b: Obj) => void): Obj => { const b = clone(shippedEatout); mutate(b); return b; };
const names = () => getFoodCatalog().map((f) => f.name);
const shippedCount = shippedFoods.foods.length as number;

describe('content reader', () => {
  const valid = (v: unknown): v is { n: number } => typeof v === 'object' && v !== null && 'n' in v;

  it('runs the validator once per load, not per call, and returns the same reference', async () => {
    await launch();
    const spy = jest.fn(valid) as unknown as typeof valid & jest.Mock;
    const get = contentReader('foods', { n: 0 }, spy);
    const first = get();
    get(); get();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(get()).toBe(first);
    await launch();
    get();
    expect(spy).toHaveBeenCalledTimes(2); // recomputed only by the next load
  });

  it('a stored copy written mid-session is not read until the next load (no hot-swap)', async () => {
    const db = await openDb();
    await loadContent(db);
    const spy = jest.fn(valid) as unknown as typeof valid & jest.Mock;
    const get = contentReader('foods', { n: 0 }, spy);
    expect(get()).toEqual({ n: 0 });
    await store(db, 'foods', { n: 1 });
    expect(get()).toEqual({ n: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    await loadContent(db);
    expect(get()).toEqual({ n: 1 });
  });

  it('a validator that throws is a rejection, not a crash', async () => {
    const db = await openDb();
    await store(db, 'foods', { n: 1 });
    await loadContent(db);
    const get = contentReader('foods', { n: 0 }, (() => { throw new Error('boom'); }) as never);
    expect(get()).toEqual({ n: 0 });
  });
});

describe('foods and eat-out through the content store', () => {
  it('uses the shipped copies when nothing is stored', async () => {
    await launch();
    expect(getFoodCatalog()).toHaveLength(shippedCount);
    expect(getCuisines()).toHaveLength(shippedEatout.cuisines.length);
    expect(getFoodCatalog()).toBe(getFoodCatalog());
  });

  it('uses a valid newer copy (additions and value edits allowed) only at the next load', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getFoodCatalog();
    const edited = foodsWith((b) => { b.foods[0].per_serving.kcal += 1; });
    await store(db, 'foods', edited);
    expect(getFoodCatalog()).toBe(before);
    expect(names()).not.toContain('Server-only test food');
    await loadContent(db);
    expect(names()).toContain('Server-only test food');
    expect(getFoodCatalog()).toHaveLength(shippedCount + 1);
    expect(getFoodCatalog()[0]!.per_serving.kcal).toBe(shippedFoods.foods[0].per_serving.kcal + 1);
  });

  it('uses a valid newer eatout copy', async () => {
    await launch({ eatout: eatoutWith((b) => { b.cuisines[0].name = 'Renamed cuisine'; }) });
    expect(getCuisines()[0]!.name).toBe('Renamed cuisine');
  });

  const foodCases: [string, (f: Obj) => void][] = [
    ['negative kcal', (f) => { f.per_serving.kcal = -1; }],
    ['huge kcal', (f) => { f.per_serving.kcal = 1e300; }],
    ['string kcal', (f) => { f.per_serving.kcal = '100'; }],
    ['NaN-like kcal (null)', (f) => { f.per_serving.kcal = null; }],
    ['missing per_serving', (f) => { delete f.per_serving; }],
    ['negative protein', (f) => { f.per_serving.protein_g = -1; }],
    ['huge protein', (f) => { f.per_serving.protein_g = 1e9; }],
    ['string carbs', (f) => { f.per_serving.carbs_g = 'x'; }],
    ['negative fat', (f) => { f.per_serving.fat_g = -0.1; }],
    ['string fat', (f) => { f.per_serving.fat_g = 'x'; }],
    ['negative fibre', (f) => { f.per_serving.fibre_g = -1; }],
    ['string fibre', (f) => { f.per_serving.fibre_g = 'x'; }],
    ['negative added sugar', (f) => { f.per_serving.added_sugar_g = -1; }],
    ['string added sugar', (f) => { f.per_serving.added_sugar_g = 'x'; }],
    ['serving grams 0', (f) => { f.serving.grams = 0; }],
    ['serving grams negative', (f) => { f.serving.grams = -30; }],
    ['serving grams huge', (f) => { f.serving.grams = 1e9; }],
    ['serving grams string', (f) => { f.serving.grams = '30'; }],
    ['serving label number', (f) => { f.serving.label = 5; }],
    ['missing serving', (f) => { delete f.serving; }],
    ['id not a uuid', (f) => { f.id = 'not-a-uuid'; }],
    ['id missing', (f) => { delete f.id; }],
    ['id null', (f) => { f.id = null; }],
    ['empty name', (f) => { f.name = ''; }],
    ['5000 character name', (f) => { f.name = 'x'.repeat(5000); }],
    ['name number', (f) => { f.name = 5; }],
    ['negative fruit_veg_servings', (f) => { f.fruit_veg_servings = -3; }],
    ['huge fruit_veg_servings', (f) => { f.fruit_veg_servings = 1e6; }],
    ['missing fruit_veg_servings', (f) => { delete f.fruit_veg_servings; }],
    ['aliases not a list', (f) => { f.aliases = 'a'; }],
    ['aliases with a number', (f) => { f.aliases = ['a', 1]; }],
    ['aliases missing', (f) => { delete f.aliases; }],
    ['source missing', (f) => { delete f.source; }],
    ['source licence missing', (f) => { delete f.source.licence; }],
    ['source licence empty', (f) => { f.source.licence = ''; }],
    ['source code number', (f) => { f.source.code = 1; }],
    ['source name number', (f) => { f.source.name = 1; }],
    ['source url number', (f) => { f.source.url = 5; }],
    ['source reference number', (f) => { f.source.reference = 5; }],
    ['name_hi number', (f) => { f.name_hi = 5; }],
    ['updated_at missing', (f) => { delete f.updated_at; }],
  ];

  it.each(foodCases)('foods: a row with %s rejects the whole copy, and About and the catalog agree', async (_n, mutate) => {
    await launch();
    const shippedKeys = getFoodSources().map(sourceKey);
    const bad = foodsWith((b) => mutate(b.foods[b.foods.length - 1]));
    await launch({ foods: bad });
    expect(names()).not.toContain('Server-only test food');
    expect(getFoodCatalog()).toHaveLength(shippedCount);
    expect(getFoodSources().map(sourceKey)).toEqual(shippedKeys);
  });

  it.each(foodCases)('eatout: a dish with %s rejects the whole copy', async (_n, mutate) => {
    await launch();
    const bad = eatoutWith((b) => mutate(b.cuisines[0].dishes[0]));
    await launch({ eatout: bad });
    expect(getCuisines()).toEqual(shippedEatout.cuisines);
  });

  const cuisineCases: [string, (b: Obj) => void][] = [
    ['empty cuisines', (b) => { b.cuisines = []; }],
    ['cuisines not a list', (b) => { b.cuisines = 'x'; }],
    ['empty dishes', (b) => { b.cuisines[0].dishes = []; }],
    ['dishes not a list', (b) => { b.cuisines[0].dishes = 'x'; }],
    ['tips missing', (b) => { delete b.cuisines[0].tips; }],
    ['tips with a number', (b) => { b.cuisines[0].tips = ['a', 2]; }],
    ['empty cuisine name', (b) => { b.cuisines[0].name = ''; }],
    ['null bundle', () => undefined],
  ];
  it.each(cuisineCases)('eatout: %s rejects the copy', async (n, mutate) => {
    const bad = n === 'null bundle' ? null : eatoutWith(mutate);
    await launch({ eatout: bad });
    expect(getCuisines()).toEqual(shippedEatout.cuisines);
  });

  it.each([[null], [[]], ['text'], [{ foods: [] }], [{ foods: 'x' }], [{ foods: [null] }]])('foods: rejects %j', async (value) => {
    await launch({ foods: value });
    expect(getFoodCatalog()).toHaveLength(shippedCount);
  });

  it('a stored copy that drops or renames a shipped food is rejected whole', async () => {
    await launch({ foods: foodsWith((b) => { b.foods.splice(1, 1); }) });
    expect(names()).not.toContain('Server-only test food');
    await launch({ foods: foodsWith((b) => { b.foods[1].name = 'Renamed'; }) });
    expect(names()).not.toContain('Renamed');
    expect(getFoodCatalog()).toHaveLength(shippedCount);
  });

  it('accepts a food with no gram weight and with null fibre and sugar', () => {
    const f = newFood();
    f.serving.grams = null;
    f.per_serving.fibre_g = null;
    f.per_serving.added_sugar_g = null;
    expect(isCatalogFood(f)).toBe(true);
    expect(isCatalogFood({ ...f, name: 'x'.repeat(200) })).toBe(true);
    expect(isCatalogFood({ ...f, name: 'x'.repeat(201) })).toBe(false);
  });
});

describe('About sources follow the same decision as the catalog', () => {
  const src = { code: 'server_src', name: 'Server source', licence: 'CC0', url: null, reference: null };

  it('a copy valid for the catalog gives the About its sources', async () => {
    await launch({ foods: foodsWith((b) => { b.foods[b.foods.length - 1].source = src; }) });
    expect(names()).toContain('Server-only test food');
    expect(getFoodSources().map(sourceKey)).toContain('server_src|Server source');
  });

  it('a copy with valid sources but a bad kcal is rejected by both (shipped sources stay)', async () => {
    await launch();
    const shippedKeys = getFoodSources().map(sourceKey);
    await launch({ foods: foodsWith((b) => { b.foods[b.foods.length - 1].source = src; b.foods[0].per_serving.kcal = 'x'; }) });
    expect(getFoodCatalog()).toHaveLength(shippedCount);
    expect(getFoodSources().map(sourceKey)).toEqual(shippedKeys);
    expect(getFoodSources().map(sourceKey)).not.toContain('server_src|Server source');
  });

  it('a row with no source is rejected by both, not accepted by the catalog alone', async () => {
    await launch({ foods: foodsWith((b) => { delete b.foods[b.foods.length - 1].source; }) });
    expect(names()).not.toContain('Server-only test food');
  });

  it('an eatout copy valid for the catalog gives the About its dish sources', async () => {
    await launch({ eatout: eatoutWith((b) => { b.cuisines[0].dishes[0].source = src; }) });
    expect(getFoodSources().map(sourceKey)).toContain('server_src|Server source');
  });

  it('raw-ingredients sources stay the shipped ones, as recipes still read the shipped copy', async () => {
    await launch({ 'raw-ingredients': { schema_version: 1, ingredients: [{ source: src }] } });
    expect(getFoodSources().map(sourceKey)).not.toContain('server_src|Server source');
  });
});
