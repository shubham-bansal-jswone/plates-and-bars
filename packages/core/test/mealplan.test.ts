import {
  buildPlan,
  planItems,
  swapPlanMeal,
  planIsCurrent,
  planForMeal,
  planDayTotals,
  groceryList,
  groceryAmount,
  combos,
  addDays,
  PLAN_DAYS,
  PLAN_OPTIONS,
  PLAN_ROTATION,
  MEAL_ORDER,
  type GroceryEntry,
  type MealDiet,
  type MealFood,
  type MealPlan,
  type MealPlanningContent,
} from '../src/index';
import foodsContent from '../../../content/foods.json';
import planningContent from '../../../content/meal-planning.json';
import { loadMealPlan, type ProtoPlan } from './prototype-meals';
import { rng } from './prototype-plan';

const proto = loadMealPlan();
const RUNS = 300;

// content is passed in as is; these assignments are the type check.
const foods: readonly MealFood[] = foodsContent.foods;
const grocery: readonly GroceryEntry[] = planningContent.grocery;
const planning: MealPlanningContent = planningContent;

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const DIETS: readonly (MealDiet | undefined)[] = [undefined, 'any', 'egg', 'veg'];
const asProto = (p: MealPlan): ProtoPlan => p as unknown as ProtoPlan;
const fromProto = (p: ProtoPlan): MealPlan => p as unknown as MealPlan;

const AGES: readonly (number | null | undefined)[] = [null, undefined, 30, 59, 60, 65, 80];

function randomTargets(rand: () => number) {
  const protein = rand() < 0.1 ? 15 + Math.round(rand() * 15) : 40 + Math.round(rand() * 180);
  return { kcal: 1200 + Math.round(rand() * 2300), protein, fat: 30 + Math.round(rand() * 80), age: pick(rand, AGES) };
}

/** The prototype settings for these targets: its `older()` reads the profile's age. */
const protoSettings = (t: ReturnType<typeof randomTargets>, diet: MealDiet | undefined) => ({
  kcal: t.kcal,
  protein: t.protein,
  fat: t.fat,
  profile: t.age != null ? { age: t.age } : null,
  ...(diet ? { diet } : {}),
});

/** A plan with random foods (some without a grocery entry) and servings, and random picks. */
function randomPlan(rand: () => number): MealPlan {
  const names = [...foods.map((f) => f.name), 'Not a food'];
  const opts: MealPlan['opts'] = {};
  for (const m of MEAL_ORDER) {
    opts[m] = Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
      Array.from({ length: 1 + Math.floor(rand() * 4) }, (): [string, number] => [pick(rand, names), pick(rand, [0.25, 0.5, 1, 1.5, 2, 3, 4.5, 7, 12])]),
    );
  }
  const days = Array.from({ length: PLAN_DAYS }, () => Object.fromEntries(MEAL_ORDER.map((m) => [m, { k: Math.floor(rand() * 5) }])));
  return { start: '2026-10-05', opts, days };
}

describe('grocery content matches the prototype', () => {
  it('content/meal-planning.json grocery is GROC, in order', () => {
    expect(grocery.map((g) => [g.food, g.items.map((i) => [i.item, i.amount, i.unit])])).toEqual(Object.entries(proto.GROC));
  });
});

describe('buildPlan and swapPlanMeal (prototype buildPlan, mp-swap)', () => {
  it('builds the prototype plan over random targets and diets, and swaps as it does', () => {
    const rand = rng(2281);
    let floored = 0;
    for (let n = 0; n < RUNS; n++) {
      const t = randomTargets(rand);
      const diet = pick(rand, DIETS);
      let plan = buildPlan(t, '2026-10-09', { foods, planning, diet });
      let want = proto.buildPlan('2026-10-09', protoSettings(t, diet));
      expect(plan).toEqual(fromProto(want));
      if (t.age != null && t.age >= 60 && t.protein >= 25 && t.protein * 0.25 < 25) floored++;
      for (let s = 0; s < 6; s++) {
        const i = Math.floor(rand() * PLAN_DAYS);
        const m = pick(rand, MEAL_ORDER);
        plan = swapPlanMeal(plan, i, m);
        want = proto.swap(want, i, m);
        expect(plan).toEqual(fromProto(want));
      }
    }
    expect(floored).toBeGreaterThan(40);
  });

  it('keeps 4 ideas per meal and rotates days over the first 3', () => {
    const plan = buildPlan({ kcal: 2000, protein: 120, fat: 60, age: null }, '2026-10-09', { foods, planning });
    expect(plan.opts.Lunch).toHaveLength(PLAN_OPTIONS);
    expect(plan.days.map((d) => d.Lunch?.k)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(PLAN_ROTATION).toBe(3);
    const swapped = swapPlanMeal(plan, 2, 'Lunch');
    expect(swapped.days[2]?.Lunch?.k).toBe(3);
    expect(swapPlanMeal(swapped, 2, 'Lunch').days[2]?.Lunch?.k).toBe(0);
    expect(plan.days[2]?.Lunch?.k).toBe(2);
  });

  it('at 60 and over, main meals aim for at least 25 g protein when the day has 25 g or more (spec §5, #239)', () => {
    // 80 g a day: breakfast 80 × 0.25 = 20, lunch and dinner 80 × 0.3 = 24, snacks 80 × 0.15 = 12
    const W = planning.meal_weights;
    const forP = (m: (typeof MEAL_ORDER)[number], kcal: number, p: number, fat: number) =>
      combos({ meal: m, kcal: kcal * W[m], protein_g: p, fat_g: fat * W[m] }, { foods, planning }).slice(0, 4).map((c) => c.items.map((i) => [i.food.name, i.qty]));
    const older = buildPlan({ kcal: 1800, protein: 80, fat: 55, age: 65 }, '2026-10-09', { foods, planning });
    expect(older.opts.Breakfast).toEqual(forP('Breakfast', 1800, 25, 55));
    expect(older.opts.Breakfast).not.toEqual(forP('Breakfast', 1800, 20, 55));
    expect(older.opts.Lunch).toEqual(forP('Lunch', 1800, 25, 55));
    expect(older.opts.Dinner).toEqual(forP('Dinner', 1800, 25, 55));
    expect(older.opts.Snacks).toEqual(forP('Snacks', 1800, 12, 55));
    expect(older).toEqual(fromProto(proto.buildPlan('2026-10-09', { kcal: 1800, protein: 80, fat: 55, profile: { age: 65 } })));
    // under 60, no profile, or under 25 g a day: no floor
    for (const age of [59, null, undefined]) expect(buildPlan({ kcal: 1800, protein: 80, fat: 55, age }, '2026-10-09', { foods, planning }).opts.Breakfast).toEqual(forP('Breakfast', 1800, 20, 55));
    const low = buildPlan({ kcal: 1200, protein: 24, fat: 40, age: 70 }, '2026-10-09', { foods, planning });
    expect(low.opts.Breakfast).toEqual(forP('Breakfast', 1200, 6, 40));
    expect(low).toEqual(fromProto(proto.buildPlan('2026-10-09', { kcal: 1200, protein: 24, fat: 40, profile: { age: 70 } })));
    // exactly 25 g a day: each main meal aims for 25 g
    expect(buildPlan({ kcal: 1200, protein: 25, fat: 40, age: 60 }, '2026-10-09', { foods, planning }).opts.Lunch).toEqual(forP('Lunch', 1200, 25, 40));
  });

  it('handles a plan with a missing day or meal', () => {
    const plan: MealPlan = { start: '2026-10-09', opts: {}, days: [{ Lunch: { k: 1 } }] };
    expect(planItems(plan, 0, 'Lunch')).toEqual([]);
    expect(planItems(plan, 3, 'Lunch')).toEqual([]);
    expect(swapPlanMeal(plan, 3, 'Lunch')).toBe(plan);
    expect(swapPlanMeal(plan, 0, 'Lunch').days[0]?.Lunch?.k).toBe(0);
  });
});

describe('groceryList (prototype grocerySheet)', () => {
  it('matches the prototype on built plans and random plans', () => {
    const rand = rng(2282);
    for (let n = 0; n < RUNS; n++) {
      let plan = n % 2 ? randomPlan(rand) : buildPlan(randomTargets(rand), '2026-10-09', { foods, planning, diet: pick(rand, DIETS) });
      if (n % 2 === 0) for (let s = 0; s < 5; s++) plan = swapPlanMeal(plan, Math.floor(rand() * PLAN_DAYS), pick(rand, MEAL_ORDER));
      const got = groceryList(plan, grocery);
      const want = proto.grocery(asProto(plan));
      expect(got.rows.map((r) => [r.item, r.label])).toEqual(want.rows);
      expect(got.text).toBe(want.text);
      expect(got.text).toBe(got.rows.map((r) => `${r.item}: ${r.label}`).join('\n'));
    }
  });

  it('sums raw amounts per item and unit; egg whites count as eggs', () => {
    const plan: MealPlan = { start: '2026-10-09', opts: { Breakfast: [[['Egg white', 3], ['Egg, whole', 2], ['Not a food', 1]]] }, days: [{ Breakfast: { k: 0 } }, { Breakfast: { k: 0 } }] };
    expect(groceryList(plan, grocery)).toEqual({ rows: [{ item: 'Eggs', unit: 'pcs', amount: 10, label: '10 pcs' }], text: 'Eggs: 10 pcs' });
  });

  it('the copied text lists items in the sorted order shown on screen (#240)', () => {
    const plan: MealPlan = { start: '2026-10-09', opts: { Lunch: [[['Roti / chapati', 2], ['Dal', 1]]] }, days: [{ Lunch: { k: 0 } }] };
    const g = groceryList(plan, grocery);
    expect(g.rows.map((r) => r.item)).toEqual(['Atta', 'Toor dal']);
    const late: MealPlan = { start: '2026-10-09', opts: { Lunch: [[['Dal', 1], ['Roti / chapati', 2]]] }, days: [{ Lunch: { k: 0 } }] };
    expect(groceryList(late, grocery).text).toBe('Atta: 60 g\nToor dal: 40 g');
    expect(groceryList(late, grocery).rows.map((r) => r.item)).toEqual(['Atta', 'Toor dal']);
    expect(proto.grocery(asProto(late)).text).toBe('Atta: 60 g\nToor dal: 40 g');
  });

  it('groceryAmount rounds g and ml to 10, switches to kg and L at 1000, rounds other units up', () => {
    expect([groceryAmount(994, 'g'), groceryAmount(996, 'g'), groceryAmount(1000, 'g'), groceryAmount(1449, 'g'), groceryAmount(1450, 'g')]).toEqual(['990 g', '1000 g', '1 kg', '1.4 kg', '1.5 kg']);
    expect([groceryAmount(875, 'ml'), groceryAmount(2625, 'ml')]).toEqual(['880 ml', '2.6 L']);
    expect([groceryAmount(4.5, 'pcs'), groceryAmount(3, 'scoops'), groceryAmount(0.25, 'slices')]).toEqual(['5 pcs', '3 scoops', '1 slices']);
  });
});

describe('saved plan reads (prototype planSheet, planForMeal)', () => {
  const plan = buildPlan({ kcal: 2100, protein: 130, fat: 65, age: null }, '2026-10-05', { foods, planning });

  it('planIsCurrent matches the prototype on reusing a saved plan', () => {
    for (let d = -2; d <= 10; d++) {
      const today = addDays('2026-10-05', d);
      expect([d, planIsCurrent(plan, today)]).toEqual([d, proto.reusesSaved(asProto(plan), today)]);
    }
    expect(planIsCurrent(null, '2026-10-05')).toBe(false);
  });

  it('planForMeal matches the prototype across and outside the week', () => {
    for (let d = -2; d <= 9; d++) {
      for (const m of MEAL_ORDER) {
        const date = addDays('2026-10-05', d);
        expect(planForMeal(plan, date, m)).toEqual(proto.planForMeal(asProto(plan), date, m));
      }
    }
    expect(planForMeal(null, '2026-10-05', 'Lunch')).toBeNull();
    expect(proto.planForMeal(null, '2026-10-05', 'Lunch')).toBeNull();
  });

  it('planDayTotals matches the prototype day lines, user foods first and names ignoring case', () => {
    const rand = rng(2283);
    const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
    for (let n = 0; n < 60; n++) {
      const p = n % 2 ? randomPlan(rand) : buildPlan(randomTargets(rand), '2026-10-05', { foods, planning });
      const myFoods = rand() < 0.5 ? [{ name: 'DAL', unit: '1 bowl', kcal: 1234, p: 50, c: 0, f: 0 }] : [];
      const all: MealFood[] = [...myFoods.map((f) => ({ name: f.name, per_serving: { kcal: f.kcal, protein_g: f.p, fat_g: f.f } })), ...foods];
      const got = p.days.map((_, i) => {
        const t = planDayTotals(p, i, all);
        return `About ${fmt(t.kcal)} kcal, ${fmt(t.protein_g)} g protein`;
      });
      expect(got).toEqual(proto.planTotals(asProto(p), myFoods));
    }
    expect(planDayTotals({ start: '2026-10-05', opts: {}, days: [] }, 0, foods)).toEqual({ kcal: 0, protein_g: 0 });
  });
});
