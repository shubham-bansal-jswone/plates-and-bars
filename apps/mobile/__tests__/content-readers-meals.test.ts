import planning from '../../../content/meal-planning.json';
import eatout from '../../../content/eatout.json';
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
/** A valid edit: Lunch 0.4 and Dinner 0.25 keep the weights summing to 1. */
const bump = (b: Obj): void => { b.meal_weights.Lunch = 0.4; b.meal_weights.Dinner = 0.25; };
const edited = (): Obj => planWith(bump);
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
    await launch({ 'meal-planning': planWith((b) => { bump(b); b.grocery[0].items[0].amount = 31; }) });
    isEdited();
    expect(getMealGrocery()[0]!.items[0]!.amount).toBe(31);
    expect(getMealGrocery()).toBe(chosenPlanning().grocery);
  });

  it('accepts additions (a new cap for a food in the catalog)', async () => {
    const food = shippedFoods.foods[0].name as string;
    await launch({ 'meal-planning': planWith((b) => { bump(b); b.max_portions[food] = 3; }) });
    isEdited();
    expect(getMealPlanning().max_portions[food]).toBe(3);
  });

  it('accepts bounds at the edge: tiny positive weights summing to 1, amount 10000, min equal to max', async () => {
    await launch({ 'meal-planning': planWith((b) => {
      b.meal_weights = { Breakfast: 0.0001, Lunch: 0.0001, Snacks: 0.0001, Dinner: 0.9997 };
      b.protein_weights.Lunch = 0.3; b.grocery[0].items[0].amount = 10000;
      b.min_portions['Egg, whole'] = b.max_portions['Egg, whole'];
    }) });
    expect(getMealPlanning().meal_weights.Dinner).toBe(0.9997);
    expect(getMealGrocery()[0]!.items[0]!.amount).toBe(10000);
    expect(getMealPlanning().min_portions['Egg, whole']).toBe(3);
  });

  it.each(['g', 'ml', 'pcs', 'scoops', 'slices'])('accepts unit %s', async (unit) => {
    await launch({ 'meal-planning': planWith((b) => { bump(b); b.grocery[0].items[0].unit = unit; }) });
    expect(getMealGrocery()[0]!.items[0]!.unit).toBe(unit);
  });

  it('accepted copies never give NaN or a weight sum other than 1', async () => {
    await launch({ 'meal-planning': edited() });
    const p = getMealPlanning();
    for (const w of [p.meal_weights, p.protein_weights]) {
      const vals = Object.values(w);
      expect(vals.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
      expect(vals.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 9);
    }
  });

  const cases: [string, (b: Obj) => void][] = [
    ['missing meal weight', (b) => { delete b.meal_weights.Dinner; }],
    ['meal weight zero (others sum to 1)', (b) => { b.meal_weights = { Breakfast: 0, Lunch: 0.4, Snacks: 0.2, Dinner: 0.4 }; }],
    ['all meal weights one', (b) => { b.meal_weights = { Breakfast: 1, Lunch: 1, Snacks: 1, Dinner: 1 }; }],
    ['meal weights sum above 1', (b) => { b.meal_weights.Lunch = 0.36; b.meal_weights.Dinner = 0.3; }],
    ['meal weights sum below 1', (b) => { b.meal_weights.Lunch = 0.3; b.meal_weights.Dinner = 0.3; }],
    ['protein weight zero (others sum to 1)', (b) => { b.protein_weights = { Breakfast: 0, Lunch: 0.4, Snacks: 0.2, Dinner: 0.4 }; }],
    ['all protein weights one', (b) => { b.protein_weights = { Breakfast: 1, Lunch: 1, Snacks: 1, Dinner: 1 }; }],
    ['protein weights sum off by 0.01', (b) => { b.protein_weights.Lunch = 0.31; }],
    ['meal weights in another key order', (b) => { b.meal_weights = { Lunch: 0.4, Breakfast: 0.25, Snacks: 0.1, Dinner: 0.25 }; }],
    ['meal weights with an extra meal', (b) => { b.meal_weights.Brunch = 0; }],
    ['max_portions empty', (b) => { b.max_portions = {}; }],
    ['min_portions empty', (b) => { b.min_portions = {}; }],
    ['grocery unit kg', (b) => { b.grocery[0].items[0].unit = 'kg'; }],
    ['grocery unit tbsp (a recipe unit, not a grocery one)', (b) => { b.grocery[0].items[0].unit = 'tbsp'; }],
    ['grocery unit uppercase', (b) => { b.grocery[0].items[0].unit = 'G'; }],
    ['duplicate role food', (b) => { b.roles.push({ ...b.roles[0] }); }],
    ['duplicate role food differing in case and spaces', (b) => { b.roles.push({ ...b.roles[0], food: ' ' + b.roles[0].food.toUpperCase() }); }],
    ['duplicate grocery food', (b) => { b.grocery.push(clone(b.grocery[0])); }],
    ['whitespace-only grocery item', (b) => { b.grocery[0].items[0].item = '   '; }],
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
    await launch({ 'meal-planning': planWith((b) => { bump(b); mutate(b); }) });
    isShipped();
  });

  it.each([[null], [[]], ['text'], [5], [{}]])('rejects a bundle that is %j', async (value) => {
    await launch({ 'meal-planning': value });
    isShipped();
  });

  describe('foods named by the plan', () => {
    it('a plan naming only an eat-out dish is rejected (known foods are the foods bundle)', async () => {
      const dish = eatout.cuisines[0]!.dishes[0]!.name;
      expect(foods.foods.map((f) => f.name)).not.toContain(dish);
      await launch({ 'meal-planning': planWith((b) => { bump(b); b.max_portions[dish] = 2; }) });
      isShipped();
    });

    it.each([
      ['upper case', (n: string) => n.toUpperCase()],
      ['leading space', (n: string) => ' ' + n],
    ])('a %s variant of a role or grocery food is a duplicate even when the foods copy has that name', async (_n, variant) => {
      const role0 = shipped.roles[0].food as string;
      const groc0 = shipped.grocery[0].food as string;
      const foodsCopy = (): Obj => {
        const f = clone(shippedFoods);
        f.foods.push({ ...clone(shippedFoods.foods[0]), id: UUID, name: variant(role0) });
        f.foods.push({ ...clone(shippedFoods.foods[0]), id: '11111111-2222-4333-8444-555555555556', name: variant(groc0) });
        return f;
      };
      // control: the variants are known foods and the plan is otherwise valid, so only the duplicate check can reject
      await launch({ foods: foodsCopy(), 'meal-planning': planWith((b) => { bump(b); b.max_portions[variant(role0)] = 2; }) });
      isEdited();
      await launch({ foods: foodsCopy(), 'meal-planning': planWith((b) => { bump(b); b.roles.push({ ...b.roles[0], food: variant(role0) }); }) });
      isShipped();
      await launch({ foods: foodsCopy(), 'meal-planning': planWith((b) => { bump(b); b.grocery.push({ ...clone(b.grocery[0]), food: variant(groc0) }); }) });
      isShipped();
    });

    it('a removed shipped role, grocery entry or cap rejects the copy', async () => {
      for (const mutate of [
        (b: Obj) => { b.roles.splice(0, 1); },
        (b: Obj) => { b.grocery.splice(0, 1); },
        (b: Obj) => { delete b.max_portions.Paneer; },
        (b: Obj) => { delete b.min_portions['Whey protein']; },
        (b: Obj) => { b.roles[0].food = 'Renamed food'; },
      ]) {
        await launch({ 'meal-planning': planWith((b) => { bump(b); mutate(b); }) });
        isShipped();
      }
    });

    it.each([
      ['a role', (b: Obj) => { b.roles.push({ food: 'Not in the catalog', role: 'p', diet: 'v' }); }],
      ['a grocery entry', (b: Obj) => { b.grocery.push({ food: 'Not in the catalog', items: [{ item: 'x', amount: 1, unit: 'g' }] }); }],
      ['a max portion', (b: Obj) => { b.max_portions['Not in the catalog'] = 2; }],
      ['a min portion', (b: Obj) => { b.min_portions['Not in the catalog'] = 1; }],
    ])('a food absent from the chosen foods in %s rejects the whole planning copy', async (_n, mutate) => {
      await launch({ 'meal-planning': planWith((b) => { bump(b); mutate(b); }) });
      isShipped();
    });

    it('the same new food is accepted when the chosen foods bundle has it, and rejected when that bundle was rejected', async () => {
      const newFood = { ...clone(shippedFoods.foods[0]), id: UUID, name: 'Server-only test food' };
      const withFood = (): Obj => { const f = clone(shippedFoods); f.foods.push(newFood); return f; };
      const plan = planWith((b) => { bump(b); b.roles.push({ food: 'Server-only test food', role: 'p', diet: 'v' }); });
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

  it('a stored value that makes the validator throw (a getter-throwing object) is a rejection, not a crash', async () => {
    const db = await openDb();
    await store(db, 'meal-planning', edited());
    await loadContent(db);
    const bad = edited();
    Object.defineProperty(bad, 'roles', { enumerable: true, get() { throw new Error('boom'); } });
    const real = JSON.parse;
    const spy = jest.spyOn(JSON, 'parse').mockImplementation((t, r) => (typeof t === 'string' && t.includes('"meal_weights"') ? bad : real(t, r)));
    try {
      await loadContent(db);
      expect(() => chosenPlanning()).not.toThrow();
      isShipped();
    } finally {
      spy.mockRestore();
    }
  });
});
