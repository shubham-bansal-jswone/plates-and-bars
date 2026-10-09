import {
  nextMealInfo,
  mealByTime,
  combos,
  combosFast,
  round05,
  ideasPage,
  logTotals,
  OLDER_MEAL_PROTEIN_G,
  IDEAS_PER_PAGE,
  IDEAS_KCAL_LEFT_MIN,
  MEAL_ORDER,
  type Meal,
  type MealDiet,
  type MealFood,
  type MealIdea,
  type MealPlanningContent,
  type MealRole,
  type MealTarget,
  type NextMealInput,
} from '../src/index';
import foodsContent from '../../../content/foods.json';
import planningContent from '../../../content/meal-planning.json';
import { prototypeSource } from './helpers';
import { loadMeals, type ProtoCombo, type ProtoMealState } from './prototype-meals';
import { rng } from './prototype-plan';

const proto = loadMeals();
const RUNS = 3000;

// content is passed in as is; these assignments are the type check.
const foods: readonly MealFood[] = foodsContent.foods;
const roles: readonly MealRole[] = planningContent.roles;
const planning: MealPlanningContent = planningContent;

/** A port idea in the prototype's shape, for comparing with the sliced `combos`. */
function toProto(c: MealIdea): { items: [string, number][]; kcal: number; p: number; fat?: number; score: number } {
  const out: { items: [string, number][]; kcal: number; p: number; fat?: number; score: number } = {
    items: c.items.map((i) => [i.food.name, i.qty]),
    kcal: c.kcal,
    p: c.protein_g,
    score: c.score,
  };
  if (c.fat_g !== undefined) out.fat = c.fat_g;
  return out;
}
const fromProto = (c: ProtoCombo) => ({ ...c, items: c.items.map(([f, q]): [string, number] => [f[0], q]) });

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
const DIETS: readonly (MealDiet | undefined)[] = [undefined, 'any', 'egg', 'veg'];

describe('meal-planning content matches the prototype', () => {
  it('weights, caps and minimums are MEAL_W, PROT_W, MAXQ and MINQ', () => {
    expect(planningContent.meal_weights).toEqual(proto.MEAL_W);
    expect(planningContent.protein_weights).toEqual(proto.PROT_W);
    expect(planningContent.max_portions).toEqual(proto.MAXQ);
    expect(planningContent.min_portions).toEqual(proto.MINQ);
    expect(MEAL_ORDER).toEqual(Object.keys(proto.MEAL_W));
  });

  it('content/foods.json holds the prototype FOODS in the same order with the same values', () => {
    expect(foods.map((f) => [f.name, f.per_serving.kcal, f.per_serving.protein_g, f.per_serving.fat_g])).toEqual(
      proto.FOODS.map((f) => [f[0], f[2], f[3], f[5]]),
    );
  });

  it('roles are the prototype ROLE table, fasting-day rows included, in order (#230)', () => {
    expect(roles.map((r) => [r.food, r.role, r.diet])).toEqual(Object.entries(proto.ROLE).map(([food, [role, diet]]) => [food, role, diet]));
    expect(roles.map((r) => r.food).slice(-7)).toEqual(['Sabudana khichdi', 'Makhana, roasted', 'Kuttu atta roti', 'Sweet potato, boiled', 'Peanuts, roasted', 'Buttermilk (chaas)', 'Fruit bowl']);
  });

  it('every food with a role is a content food', () => {
    const names = new Set(foods.map((f) => f.name));
    expect(roles.filter((r) => !names.has(r.food))).toEqual([]);
  });
});

describe('combos (prototype combos)', () => {
  it('matches the prototype over random targets, meals and diets', () => {
    const rand = rng(228);
    for (let n = 0; n < RUNS; n++) {
      const meal = pick(rand, MEAL_ORDER);
      const info: MealTarget = { meal, kcal: Math.round(rand() * 1400) - 100, protein_g: rand() * 90 - 5 };
      if (rand() < 0.8) info.fat_g = rand() * 45;
      const diet = pick(rand, DIETS);
      const got = combos(info, { foods, planning, diet }).map(toProto);
      const want = proto.combos({ meal, kcal: info.kcal, p: info.protein_g, f: info.fat_g }, diet).map(fromProto);
      expect(got).toEqual(want);
    }
  });

  it('veg leaves out eggs and meat; egg keeps eggs but not meat', () => {
    const names = (diet: MealDiet, meal: Meal) => new Set(combos({ meal, kcal: 600, protein_g: 35, fat_g: 15 }, { foods, planning, diet }).flatMap((c) => c.items.map((i) => i.food.name)));
    for (const meal of MEAL_ORDER) {
      const veg = names('veg', meal);
      expect([...veg].filter((n) => ['e', 'n'].includes(roles.find((r) => r.food === n)?.diet ?? ''))).toEqual([]);
      const egg = names('egg', meal);
      expect([...egg].filter((n) => roles.find((r) => r.food === n)?.diet === 'n')).toEqual([]);
    }
    expect(names('egg', 'Breakfast').has('Egg, whole')).toBe(true);
    expect(names('any', 'Dinner').has('Chicken breast, cooked')).toBe(true);
  });

  it('keeps portions within the caps and minimums', () => {
    for (const meal of MEAL_ORDER) {
      for (const c of combos({ meal, kcal: 900, protein_g: 70 }, { foods, planning })) {
        const main = c.items[meal === 'Breakfast' ? 1 : 0];
        if (!main) throw new Error('no main');
        const cap = planning.max_portions[main.food.name];
        if (cap !== undefined) expect(main.qty).toBeLessThanOrEqual(cap);
        expect(main.qty).toBeGreaterThanOrEqual(planning.min_portions[main.food.name] ?? 1);
      }
    }
  });

  it('puts the best idea of each main protein first, then ideas reaching 85% of protein ahead of the rest', () => {
    const list = combos({ meal: 'Lunch', kcal: 650, protein_g: 40, fat_g: 18 }, { foods, planning });
    const mains = list.map((c) => c.items[0]?.food.name);
    const distinct = new Set(mains).size;
    expect(new Set(mains.slice(0, distinct)).size).toBe(distinct);
    expect(list[0]?.protein_g).toBeGreaterThanOrEqual(40 * 0.85);
  });

  it('skips a missing carb and missing roles instead of throwing', () => {
    const noRice = foods.filter((f) => f.name !== 'Rice, cooked');
    const ideas = combos({ meal: 'Dinner', kcal: 600, protein_g: 30 }, { foods: noRice, planning });
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas.some((c) => c.items.some((i) => i.food.name === 'Rice, cooked'))).toBe(false);
    // with no roles only the whole egg (added by name) is a main, and breakfast has no base
    const noRoles = { foods, planning: { ...planning, roles: [] } };
    expect(new Set(combos({ meal: 'Lunch', kcal: 600, protein_g: 30 }, noRoles).map((c) => c.items[0]?.food.name))).toEqual(new Set(['Egg, whole']));
    expect(combos({ meal: 'Breakfast', kcal: 400, protein_g: 20 }, noRoles)).toEqual([]);
  });

  it('reads caps by own name only and returns the food objects passed in', () => {
    const odd: MealFood = { name: 'constructor', per_serving: { kcal: 100, protein_g: 20, fat_g: 1 } };
    const ideas = combos({ meal: 'Snacks', kcal: 200, protein_g: 20 }, { foods: [...foods, odd], planning: { ...planning, roles: [...roles, { food: 'constructor', role: 'sp', diet: 'v' }] } });
    const it = ideas.find((c) => c.items[0]?.food === odd);
    expect(it?.items[0]?.qty).toBe(1);
  });
});

describe('combosFast (prototype combosFast)', () => {
  it('matches the prototype over random targets and meals', () => {
    const rand = rng(1228);
    for (let n = 0; n < RUNS; n++) {
      const meal = pick(rand, MEAL_ORDER);
      const info: MealTarget = { meal, kcal: Math.round(rand() * 1400) - 100, protein_g: rand() * 90 - 5 };
      expect(combosFast(info, { foods }).map(toProto)).toEqual(proto.combosFast({ meal, kcal: info.kcal, p: info.protein_g }).map(fromProto));
    }
  });

  it('adds buttermilk to lunch and dinner only, and skips pairs with a missing food', () => {
    expect(combosFast({ meal: 'Lunch', kcal: 500, protein_g: 20 }, { foods }).every((c) => c.items[2]?.food.name === 'Buttermilk (chaas)')).toBe(true);
    expect(combosFast({ meal: 'Snacks', kcal: 200, protein_g: 8 }, { foods }).every((c) => c.items.length === 2)).toBe(true);
    expect(combosFast({ meal: 'Dinner', kcal: 500, protein_g: 20 }, { foods: foods.filter((f) => f.name !== 'Buttermilk (chaas)') })).toEqual([]);
    const noPaneer = combosFast({ meal: 'Breakfast', kcal: 400, protein_g: 20 }, { foods: foods.filter((f) => f.name !== 'Paneer') });
    expect(noPaneer.some((c) => c.items[0]?.food.name === 'Paneer')).toBe(false);
    expect(noPaneer.length).toBeGreaterThan(0);
  });
});

describe('nextMealInfo (prototype nextMealInfo)', () => {
  const base = (over: Partial<NextMealInput> = {}): NextMealInput => ({
    date: '2026-10-09',
    today: '2026-10-09',
    hour: 8,
    logs: [],
    totals: { kcal: 0, protein_g: 0, fat_g: 0 },
    kcalTarget: 2000,
    proteinTarget: 120,
    fatTarget: 60,
    age: 30,
    planning,
    ...over,
  });

  it('matches the prototype over random days, hours, logs, targets and ages', () => {
    const rand = rng(2280);
    const names = foods.map((f) => f.name);
    for (let n = 0; n < RUNS; n++) {
      const meals = Array.from({ length: Math.floor(rand() * 6) }, () => {
        const f = pick(rand, foods);
        return { meal: pick(rand, MEAL_ORDER), name: pick(rand, names), qty: pick(rand, [0.5, 1, 1.5, 2, 3]), kcal: f.per_serving.kcal, p: f.per_serving.protein_g, c: 10, f: f.per_serving.fat_g };
      });
      const st: ProtoMealState = {
        date: '2026-10-09',
        today: rand() < 0.9 ? '2026-10-09' : '2026-10-10',
        hour: Math.floor(rand() * 24),
        meals,
        kcalTarget: 1200 + Math.round(rand() * 1800),
        settings: { protein: 40 + Math.round(rand() * 160), fat: 30 + Math.round(rand() * 60), profile: rand() < 0.15 ? null : { age: 18 + Math.floor(rand() * 70) } },
      };
      const logs = meals.map((m) => ({ meal: m.meal, name: m.name, qty: m.qty, kcal: m.kcal, protein_g: m.p, carbs_g: m.c, fat_g: m.f }));
      const t = logTotals(logs, []);
      const got = nextMealInfo({
        date: st.date,
        today: st.today,
        hour: st.hour,
        logs,
        totals: t,
        kcalTarget: st.kcalTarget,
        proteinTarget: st.settings.protein,
        fatTarget: st.settings.fat,
        age: st.settings.profile?.age,
        planning,
      });
      const want = proto.nextMealInfo(st);
      expect(got && { meal: got.meal, kcalLeft: got.kcalLeft, pLeft: got.proteinLeft, kcal: got.kcal, p: got.protein_g, f: got.fat_g }).toEqual(want);
    }
  });

  it('gives a 60+ user at least 25 g protein per main meal when that much is left, not for snacks', () => {
    expect(nextMealInfo(base({ age: 60, proteinTarget: 60 }))?.protein_g).toBe(OLDER_MEAL_PROTEIN_G);
    expect(nextMealInfo(base({ age: 59, proteinTarget: 60 }))?.protein_g).toBe(15);
    expect(nextMealInfo(base({ age: 70, hour: 17, proteinTarget: 100 }))?.protein_g).toBeCloseTo((100 * 0.15) / 0.45, 10);
    // boundary: exactly 25 g left still gets the floor (prototype pLeft >= 25)
    expect(nextMealInfo(base({ age: 60, proteinTarget: 25 }))?.protein_g).toBe(OLDER_MEAL_PROTEIN_G);
    expect(nextMealInfo(base({ age: 70, proteinTarget: 24 }))?.protein_g).toBe(6);
    expect(nextMealInfo(base({ age: null, proteinTarget: 60 }))?.protein_g).toBe(15);
  });

  it('skips meals already logged, ignores deleted logs, and is null on another day or after the last meal', () => {
    expect(nextMealInfo(base({ logs: [{ meal: 'Breakfast' }] }))?.meal).toBe('Lunch');
    expect(nextMealInfo(base({ logs: [{ meal: 'Breakfast', deleted_at: '2026-10-09T09:00:00Z' }] }))?.meal).toBe('Breakfast');
    expect(nextMealInfo(base({ hour: 21, logs: [{ meal: 'Dinner' }] }))).toBeNull();
    expect(nextMealInfo(base({ today: '2026-10-10' }))).toBeNull();
  });

  it('never asks for negative calories or fat', () => {
    const r = nextMealInfo(base({ totals: { kcal: 2500, protein_g: 150, fat_g: 90 } }));
    expect(r).toMatchObject({ kcal: 0, fat_g: 0, protein_g: 0, kcalLeft: -500, proteinLeft: -30 });
  });
});

describe('helpers', () => {
  it('mealByTime switches at 11, 16 and 19', () => {
    expect([0, 10, 11, 15, 16, 18, 19, 23].map(mealByTime)).toEqual(['Breakfast', 'Breakfast', 'Lunch', 'Lunch', 'Snacks', 'Snacks', 'Dinner', 'Dinner']);
  });

  it('round05 rounds to halves, at least 0.5', () => {
    expect([-1, 0, 0.2, 0.74, 0.75, 1.24, 1.25, 2.6].map(round05)).toEqual([0.5, 0.5, 0.5, 0.5, 1, 1, 1.5, 2.5]);
  });

  it('ideasPage pages by 3, wraps, and flags when the best shown misses 85% of protein', () => {
    const ideas = combos({ meal: 'Lunch', kcal: 600, protein_g: 35 }, { foods, planning });
    const pages = Math.ceil(ideas.length / IDEAS_PER_PAGE);
    expect(ideasPage(ideas, 0, { protein_g: 35 })).toMatchObject({ page: 0, pages, ideas: ideas.slice(0, 3), proteinHard: false });
    expect(ideasPage(ideas, pages + 1, { protein_g: 35 }).page).toBe(1);
    expect(ideasPage(ideas, 0, { protein_g: 500 }).proteinHard).toBe(true);
    expect(ideasPage([], 4, { protein_g: 35 })).toEqual({ ideas: [], page: 0, pages: 1, proteinHard: false });
    expect(IDEAS_KCAL_LEFT_MIN).toBe(120);
  });

  it('the prototype pages by 3 and stops ideas at 120 kcal left', () => {
    const src = prototypeSource();
    expect(src).toContain('if(info.kcalLeft <= 120){');
    expect(src).toContain('pages = Math.max(1, Math.ceil(all.length / 3)), pg = (S.ui.gpage || 0) % pages, cs = all.slice(pg*3, pg*3 + 3);');
    expect(src).toContain("cs.length && cs[0].p < info.p*0.85 ?");
  });
});
