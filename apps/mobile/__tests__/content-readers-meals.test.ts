import planning from '../../../content/meal-planning.json';
import foods from '../../../content/foods.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { getFoodCatalog } from '../src/food/catalog';
import { chosenPlanning, getMealGrocery, getMealPlanning } from '../src/meals/content';
import { openDb } from './sync-helpers';

const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shipped = planning as unknown as Obj;
const shippedFoods = foods as unknown as Obj;
const UUID = '11111111-2222-4333-8444-555555555555';

async function store(db: ContentDb, name: string, value: unknown): Promise<void> {
  await putStored(db, { name, sha256: 'x', schema_version: BUNDLED[name]!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
async function launch(stored: Record<string, unknown> = {}): Promise<void> {
  const db = await openDb();
  for (const [n, v] of Object.entries(stored)) await store(db, n, v);
  await loadContent(db);
}
const planWith = (mutate: (b: Obj) => void): Obj => { const b = clone(shipped); mutate(b); return b; };
const edited = (): Obj => planWith((b) => { b.meal_weights.Lunch = 0.4; });
const isShipped = () => {
  expect(getMealPlanning().meal_weights).toEqual(shipped.meal_weights);
  expect(getMealGrocery()).toEqual(shipped.grocery);
  expect(chosenPlanning()).toBe(planning);
};
const isEdited = () => {
  expect(getMealPlanning().meal_weights.Lunch).toBe(0.4);
  expect(chosenPlanning()).not.toBe(planning);
};

describe('meal planning through the content store', () => {
  it('uses the shipped copy when nothing is stored, memoised', async () => {
    await launch();
    isShipped();
    expect(getMealPlanning()).toBe(getMealPlanning());
    expect(getMealGrocery()).toBe(getMealGrocery());
  });

  it('uses a valid newer copy only at the next load', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getMealPlanning();
    await store(db, 'meal-planning', edited());
    expect(getMealPlanning()).toBe(before);
    expect(getMealPlanning().meal_weights.Lunch).toBe(shipped.meal_weights.Lunch);
    await loadContent(db);
    isEdited();
  });

  it('planning, grocery and the decision agree on an accepted copy', async () => {
    await launch({ 'meal-planning': planWith((b) => { b.meal_weights.Lunch = 0.4; b.grocery[0].items[0].amount = 31; }) });
    isEdited();
    expect(getMealGrocery()[0]!.items[0]!.amount).toBe(31);
    expect(getMealGrocery()).toBe(chosenPlanning().grocery);
  });

  it('accepts additions (a new role and grocery entry for a food in the catalog, a new cap)', async () => {
    const food = shippedFoods.foods[0].name as string;
    const extra = shipped.roles.every((r: Obj) => r.food !== food) ? food : null;
    // the first food may already have a role; add a cap for a food in the catalog instead
    const b = planWith((x) => { x.max_portions[extra ?? food] = 3; x.meal_weights.Lunch = 0.4; });
    await launch({ 'meal-planning': b });
    isEdited();
    expect(getMealPlanning().max_portions[food]).toBe(3);
  });

  it('accepts bounds at the edge', async () => {
    await launch({ 'meal-planning': planWith((b) => { b.meal_weights.Lunch = 1; b.protein_weights.Lunch = 0; b.grocery[0].items[0].amount = 10000; b.roles[0].food = shipped.roles[0].food; }) });
    expect(getMealPlanning().meal_weights.Lunch).toBe(1);
    expect(getMealGrocery()[0]!.items[0]!.amount).toBe(10000);
  });

  const cases: [string, (b: Obj) => void][] = [
    ['missing meal weight', (b) => { delete b.meal_weights.Dinner; }],
    ['negative meal weight', (b) => { b.meal_weights.Lunch = -0.1; }],
    ['meal weight over 1', (b) => { b.meal_weights.Lunch = 1.5; }],
    ['string meal weight', (b) => { b.meal_weights.Lunch = '0.3'; }],
    ['meal_weights missing', (b) => { delete b.meal_weights; }],
    ['missing protein weight', (b) => { delete b.protein_weights.Snacks; }],
    ['negative protein weight', (b) => { b.protein_weights.Lunch = -1; }],
    ['protein weight over 1', (b) => { b.protein_weights.Lunch = 2; }],
    ['protein_weights not an object', (b) => { b.protein_weights = []; }],
    ['max portion zero', (b) => { b.max_portions.Paneer = 0; }],
    ['max portion negative', (b) => { b.max_portions.Paneer = -1; }],
    ['max portion huge', (b) => { b.max_portions.Paneer = 1e9; }],
    ['max portion string', (b) => { b.max_portions.Paneer = '2'; }],
    ['max_portions missing', (b) => { delete b.max_portions; }],
    ['min portion zero', (b) => { b.min_portions['Whey protein'] = 0; }],
    ['min portion huge', (b) => { b.min_portions['Whey protein'] = 1e9; }],
    ['min portion string', (b) => { b.min_portions['Whey protein'] = 'x'; }],
    ['min above max for one food', (b) => { b.min_portions['Egg, whole'] = 4; }],
    ['min_portions null', (b) => { b.min_portions = null; }],
    ['role code not known', (b) => { b.roles[0].role = 'zzz'; }],
    ['role code number', (b) => { b.roles[0].role = 1; }],
    ['diet code not known', (b) => { b.roles[0].diet = 'x'; }],
    ['role missing', (b) => { delete b.roles[0].role; }],
    ['role food empty', (b) => { b.roles[0].food = ''; }],
    ['role food 5000 characters', (b) => { b.roles[0].food = 'x'.repeat(5000); }],
    ['role row null', (b) => { b.roles.push(null); }],
    ['roles empty', (b) => { b.roles = []; }],
    ['roles not a list', (b) => { b.roles = 'x'; }],
    ['grocery empty', (b) => { b.grocery = []; }],
    ['grocery not a list', (b) => { b.grocery = {}; }],
    ['grocery food empty', (b) => { b.grocery[0].food = ''; }],
    ['grocery items empty', (b) => { b.grocery[0].items = []; }],
    ['grocery items missing', (b) => { delete b.grocery[0].items; }],
    ['grocery amount zero', (b) => { b.grocery[0].items[0].amount = 0; }],
    ['grocery amount negative', (b) => { b.grocery[0].items[0].amount = -5; }],
    ['grocery amount huge', (b) => { b.grocery[0].items[0].amount = 1e9; }],
    ['grocery amount string', (b) => { b.grocery[0].items[0].amount = '30'; }],
    ['grocery amount null', (b) => { b.grocery[0].items[0].amount = null; }],
    ['grocery item name empty', (b) => { b.grocery[0].items[0].item = ''; }],
    ['grocery item name 5000 characters', (b) => { b.grocery[0].items[0].item = 'x'.repeat(5000); }],
    ['grocery unit empty', (b) => { b.grocery[0].items[0].unit = ''; }],
    ['grocery unit number', (b) => { b.grocery[0].items[0].unit = 1; }],
  ];
  it.each(cases)('%s rejects the whole copy (every reader falls back together)', async (_n, mutate) => {
    await launch({ 'meal-planning': planWith((b) => { b.meal_weights.Lunch = 0.4; mutate(b); }) });
    isShipped();
  });

  it.each([[null], [[]], ['text'], [5], [{}]])('rejects a bundle that is %j', async (value) => {
    await launch({ 'meal-planning': value });
    isShipped();
  });

  describe('foods named by the plan', () => {
    it('a removed shipped role, grocery entry or cap rejects the copy', async () => {
      for (const mutate of [
        (b: Obj) => { b.roles.splice(0, 1); },
        (b: Obj) => { b.grocery.splice(0, 1); },
        (b: Obj) => { delete b.max_portions.Paneer; },
        (b: Obj) => { delete b.min_portions['Whey protein']; },
        (b: Obj) => { b.roles[0].food = 'Renamed food'; },
      ]) {
        await launch({ 'meal-planning': planWith((b) => { b.meal_weights.Lunch = 0.4; mutate(b); }) });
        isShipped();
      }
    });

    it.each([
      ['a role', (b: Obj) => { b.roles.push({ food: 'Not in the catalog', role: 'p', diet: 'v' }); }],
      ['a grocery entry', (b: Obj) => { b.grocery.push({ food: 'Not in the catalog', items: [{ item: 'x', amount: 1, unit: 'g' }] }); }],
      ['a max portion', (b: Obj) => { b.max_portions['Not in the catalog'] = 2; }],
      ['a min portion', (b: Obj) => { b.min_portions['Not in the catalog'] = 1; }],
    ])('a food absent from the chosen foods in %s rejects the whole planning copy', async (_n, mutate) => {
      await launch({ 'meal-planning': planWith((b) => { b.meal_weights.Lunch = 0.4; mutate(b); }) });
      isShipped();
    });

    it('the same new food is accepted when the chosen foods bundle has it, and rejected when that bundle was rejected', async () => {
      const newFood = { ...clone(shippedFoods.foods[0]), id: UUID, name: 'Server-only test food' };
      const withFood = (): Obj => { const f = clone(shippedFoods); f.foods.push(newFood); return f; };
      const plan = planWith((b) => { b.meal_weights.Lunch = 0.4; b.roles.push({ food: 'Server-only test food', role: 'p', diet: 'v' }); });
      await launch({ foods: withFood(), 'meal-planning': plan });
      expect(getFoodCatalog().map((f) => f.name)).toContain('Server-only test food');
      isEdited();
      expect(getMealPlanning().roles.map((r) => r.food)).toContain('Server-only test food');
      // the foods copy is invalid (bad kcal), so the catalog is the shipped one and the plan naming the new food falls back
      const bad = withFood();
      bad.foods[bad.foods.length - 1].per_serving.kcal = -1;
      await launch({ foods: bad, 'meal-planning': plan });
      expect(getFoodCatalog().map((f) => f.name)).not.toContain('Server-only test food');
      isShipped();
    });
  });

  it('a decision that throws is not a crash: planning stays usable from the shipped copy', async () => {
    await launch({ 'meal-planning': { meal_weights: null } });
    expect(getMealPlanning().roles.length).toBe(shipped.roles.length);
  });
});
