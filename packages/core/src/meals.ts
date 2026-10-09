/**
 * Meal ideas (spec §5 "Meal ideas"): what to eat next, and portion combos that fit it.
 *
 * The data is content, not code, and is passed in: meal and protein weights (prototype `MEAL_W`,
 * `PROT_W`), portion caps and minimums (`MAXQ`, `MINQ`) and food roles (`ROLE`) as
 * content/meal-planning.json, and foods as content/foods.json `foods` (in that order: the order breaks
 * ties between equally good ideas, as the prototype's `FOODS` order does). The combo shapes (which
 * sides go with a main, the fasting-day pools) are the prototype's inline lists and stay here.
 */

/** The four meals, in the prototype's day order (`MEALS`). */
export type Meal = 'Breakfast' | 'Lunch' | 'Snacks' | 'Dinner';

/** Prototype day order of meals. */
export const MEAL_ORDER: readonly Meal[] = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];

/** Meal-idea diet filter: contract `Settings.diet`. A missing value is `any`. */
export type MealDiet = 'any' | 'egg' | 'veg';

/** A food's role and diet: an entry of content/meal-planning.json `roles` (prototype `ROLE[food]`, #230). */
export interface MealRole {
  food: string;
  /** `p` main protein, `c` carb, `v` veg, `b` breakfast base, `bp` breakfast protein, `sp` snack protein, `s` snack, `f` fruit, `side`. */
  role: string;
  /** `v` vegetarian, `e` egg, `n` non-veg. */
  diet: string;
}

/** The fields of content/meal-planning.json read here. */
export interface MealPlanningContent {
  meal_weights: Readonly<Record<Meal, number>>;
  protein_weights: Readonly<Record<Meal, number>>;
  max_portions: Readonly<Record<string, number>>;
  min_portions: Readonly<Record<string, number>>;
  roles: readonly MealRole[];
}

/** A food as the meal rules read it: content/foods.json `Food` or `userFoodFacts(...)`. */
export interface MealFood {
  name: string;
  per_serving: { kcal: number; protein_g: number; fat_g: number };
}

/** One food of an idea and its servings (prototype `[f, q]`). */
export interface MealIdeaItem<T extends MealFood = MealFood> {
  food: T;
  qty: number;
}

/** A meal idea: its items, unrounded totals and score (lower is better). `fat_g` is absent on fasting-day ideas, as in the prototype. */
export interface MealIdea<T extends MealFood = MealFood> {
  items: MealIdeaItem<T>[];
  kcal: number;
  protein_g: number;
  fat_g?: number;
  score: number;
}

/** What the next meal should hold (prototype `nextMealInfo()` result, or the per-meal targets `buildPlan` makes). */
export interface MealTarget {
  meal: Meal;
  kcal: number;
  protein_g: number;
  fat_g?: number | undefined;
}

/** Foods, content and the diet filter, shared by `combos` and `combosFast`. */
export interface MealIdeasInput<T extends MealFood = MealFood> {
  foods: readonly T[];
  planning: MealPlanningContent;
  diet?: MealDiet | null | undefined;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const own = (o: Readonly<Record<string, number>>, k: string): number | undefined => (hasOwn(o, k) ? o[k] : undefined);

/** Meal shown first by the clock: before 11 breakfast, before 16 lunch, before 19 snacks, then dinner. Mirrors prototype `mealByTime()` (hour passed in). */
export function mealByTime(hour: number): Meal {
  return hour < 11 ? 'Breakfast' : hour < 16 ? 'Lunch' : hour < 19 ? 'Snacks' : 'Dinner';
}

/** Rounds to the nearest half serving, at least 0.5. Mirrors prototype `round05`. */
export function round05(x: number): number {
  return Math.max(0.5, Math.round(x * 2) / 2);
}

/** Protein a 60+ user gets at least per main meal, when that much is left (spec §5). */
export const OLDER_MEAL_PROTEIN_G = 25;

/** Input to `nextMealInfo`. */
export interface NextMealInput {
  /** The day shown and today; ideas are only for today. */
  date: string;
  today: string;
  /** Local hour now (0–23). */
  hour: number;
  /** The day's logs (contract `FoodLog`); deleted ones are left out. */
  logs: readonly { meal: string; deleted_at?: string | null | undefined }[];
  /** The day's totals (`logTotals`). */
  totals: { kcal: number; protein_g: number; fat_g: number };
  /** Today's calorie target (`kcalTarget`), and the settings protein and fat targets. */
  kcalTarget: number;
  proteinTarget: number;
  fatTarget: number;
  /** Profile age; 60 and over gets at least 25 g protein per main meal. */
  age: number | null | undefined;
  planning: Pick<MealPlanningContent, 'meal_weights' | 'protein_weights'>;
}

/** The next meal and its share of what is left today. */
export interface NextMeal extends MealTarget {
  kcalLeft: number;
  proteinLeft: number;
  fat_g: number;
}

/**
 * The first meal from now that has nothing logged, and its share of the calories, protein and fat
 * left today (weighted over the meals still to come). Null on another day or when every meal from now
 * has logs. Mirrors prototype `nextMealInfo()`.
 */
export function nextMealInfo(input: NextMealInput): NextMeal | null {
  if (input.date !== input.today) return null;
  const { meal_weights: W, protein_weights: PW } = input.planning;
  const live = input.logs.filter((l) => !l.deleted_at);
  let i = MEAL_ORDER.indexOf(mealByTime(input.hour));
  while (i < MEAL_ORDER.length && live.some((l) => l.meal === MEAL_ORDER[i])) i++;
  const meal = MEAL_ORDER[i];
  if (meal === undefined) return null;
  const left = MEAL_ORDER.slice(i);
  const wsum = left.reduce((a, m) => a + W[m], 0);
  const psum = left.reduce((a, m) => a + PW[m], 0);
  const t = input.totals;
  const kcalLeft = input.kcalTarget - t.kcal;
  const proteinLeft = input.proteinTarget - t.protein_g;
  const older = input.age != null && input.age >= 60;
  const floor = older && meal !== 'Snacks' && proteinLeft >= OLDER_MEAL_PROTEIN_G ? OLDER_MEAL_PROTEIN_G : 0;
  return {
    meal,
    kcalLeft,
    proteinLeft,
    kcal: Math.max(0, (kcalLeft * W[meal]) / wsum),
    protein_g: Math.max(floor, (proteinLeft * PW[meal]) / psum),
    fat_g: Math.max(0, ((input.fatTarget - t.fat_g) * W[meal]) / wsum),
  };
}

/** Calories left at or below this show "you've reached today's calories" instead of ideas. Mirrors the 120 in prototype `guidanceHtml()`. */
export const IDEAS_KCAL_LEFT_MIN = 120;

/** Ideas shown per page. Mirrors the 3 in prototype `guidanceHtml()`. */
export const IDEAS_PER_PAGE = 3;

/** One page of ideas: wraps around, and flags when even the best shown misses 85% of the protein. Mirrors the paging in prototype `guidanceHtml()`. */
export function ideasPage<T extends MealFood>(
  ideas: readonly MealIdea<T>[],
  page: number,
  target: Pick<MealTarget, 'protein_g'>,
): { ideas: MealIdea<T>[]; page: number; pages: number; proteinHard: boolean } {
  const pages = Math.max(1, Math.ceil(ideas.length / IDEAS_PER_PAGE));
  const pg = (page || 0) % pages;
  const shown = ideas.slice(pg * IDEAS_PER_PAGE, pg * IDEAS_PER_PAGE + IDEAS_PER_PAGE);
  const first = shown[0];
  return { ideas: shown, page: pg, pages, proteinHard: first !== undefined && first.protein_g < target.protein_g * 0.85 };
}

/** Food lookups shared by both combo builders: first food of a name, role and diet filter. */
function context<T extends MealFood>(input: MealIdeasInput<T>) {
  const byName = new Map<string, T>();
  for (const f of input.foods) if (!byName.has(f.name)) byName.set(f.name, f);
  const roles = new Map<string, MealRole>();
  for (const r of input.planning.roles) if (!roles.has(r.food)) roles.set(r.food, r);
  const d = input.diet || 'any';
  // prototype dietOK (its 'nonveg' is not a contract value; any other diet reads as vegetarian)
  const dietOK = (n: string): boolean => {
    const r = roles.get(n);
    if (!r) return true;
    return d === 'any' || (d === 'egg' ? r.diet !== 'n' : r.diet === 'v');
  };
  const F = (n: string): T | undefined => byName.get(n);
  const byRole = (role: string): T[] => input.foods.filter((f) => roles.get(f.name)?.role === role && dietOK(f.name));
  const ok = (n: string): boolean => F(n) !== undefined && dietOK(n);
  return { F, byRole, ok };
}

const SIDE_SETS: readonly (readonly string[])[] = [
  ['Mixed veg sabzi'],
  ['Mixed veg sabzi', 'Curd / dahi'],
  ['Mixed veg sabzi', 'Greek yogurt, plain'],
  ['Mixed veg sabzi', 'Sprouts salad'],
  ['Mixed veg sabzi', 'Egg white'],
];
const MAIN_CARBS: readonly string[] = ['Roti / chapati', 'Rice, cooked'];
const BREAKFAST_EXTRAS: readonly (string | null)[] = [null, 'Greek yogurt, plain', 'Egg white', 'Toned milk', 'Whey protein'];
/** Egg whites come three to a serving in sides and extras. */
const sideQty = (n: string): number => (n === 'Egg white' ? 3 : 1);

/**
 * Meal ideas for one meal, best first: protein shortfall weighs 3× the calorie error, going over 110%
 * of calories and under 60% of fat cost extra. Lunch and dinner are a main protein, roti or rice and
 * sides; breakfast a base, a protein and an optional extra; snacks a snack protein with or without
 * fruit. Portions keep to the caps and minimums; the best idea of each main protein comes first, and
 * ideas reaching 85% of the protein come before the rest. Mirrors prototype `combos(info)`.
 *
 * Carbs (roti, rice) are not diet-filtered, as in the prototype; where one is missing from `foods` it
 * is skipped (the prototype throws).
 */
export function combos<T extends MealFood>(info: MealTarget, input: MealIdeasInput<T>): MealIdea<T>[] {
  const { F, byRole, ok } = context(input);
  const { max_portions: MAXQ, min_portions: MINQ } = input.planning;
  const out: MealIdea<T>[] = [];
  const K = Math.max(info.kcal, 150);
  const P = Math.max(info.protein_g, 8);
  const Fm = Math.max(info.fat_g || 0, 5);
  const mk = (items: MealIdeaItem<T>[]): MealIdea<T> => {
    const t = items.reduce(
      (a, { food: f, qty: q }) => ({ kcal: a.kcal + f.per_serving.kcal * q, p: a.p + f.per_serving.protein_g * q, fat: a.fat + f.per_serving.fat_g * q }),
      { kcal: 0, p: 0, fat: 0 },
    );
    const score =
      (3 * Math.max(0, P - t.p)) / P +
      (0.3 * Math.max(0, t.p - P * 1.3)) / P +
      Math.abs(t.kcal - K) / K +
      (2 * Math.max(0, t.kcal - K * 1.1)) / K +
      (0.6 * Math.max(0, Fm * 0.6 - t.fat)) / Fm;
    return { items, kcal: t.kcal, protein_g: t.p, fat_g: t.fat, score };
  };
  const qFor = (f: T, need: number, cap: number): number => {
    const q = need / Math.max(f.per_serving.protein_g, 1);
    const lo = own(MINQ, f.name) || 1;
    return f.name === 'Egg, whole' ? Math.max(lo, Math.min(cap, Math.round(q))) : Math.max(lo, Math.min(cap, round05(q)));
  };
  const sum = (items: MealIdeaItem<T>[]) =>
    items.reduce((a, { food: f, qty: q }) => ({ kcal: a.kcal + f.per_serving.kcal * q, p: a.p + f.per_serving.protein_g * q }), { kcal: 0, p: 0 });
  const item = (n: string, qty: number): MealIdeaItem<T> => ({ food: F(n) as T, qty });

  if (info.meal === 'Lunch' || info.meal === 'Dinner') {
    const egg = F('Egg, whole');
    const mains = [...byRole('p'), ...(egg && ok('Egg, whole') ? [egg] : [])];
    const sides = SIDE_SETS.filter((set) => set.every(ok));
    mains.forEach((pf) =>
      MAIN_CARBS.forEach((cn) =>
        sides.forEach((set) => {
          const cf = F(cn);
          if (!cf) return;
          const side = set.map((n) => item(n, sideQty(n)));
          const st = sum(side);
          const pq = qFor(pf, Math.max(P - st.p - 8, 6), own(MAXQ, pf.name) || 2);
          let cq = (K - pf.per_serving.kcal * pq - st.kcal) / cf.per_serving.kcal;
          cq = cn.startsWith('Roti') ? Math.max(1, Math.min(4, Math.round(cq))) : Math.max(0.5, Math.min(2, round05(cq)));
          out.push(mk([{ food: pf, qty: pq }, { food: cf, qty: cq }, ...side]));
        }),
      ),
    );
  } else if (info.meal === 'Breakfast') {
    const prots = [...byRole('bp'), ...byRole('sp').filter((f) => f.name === 'Whey protein')];
    byRole('b').forEach((bf) =>
      prots.forEach((pf) =>
        BREAKFAST_EXTRAS.forEach((xn) => {
          if (xn && (xn === pf.name || !ok(xn))) return;
          const extra = xn ? [item(xn, sideQty(xn))] : [];
          const et = sum(extra);
          const pq = qFor(pf, Math.max(P - et.p - 6, 6), own(MAXQ, pf.name) || 2);
          let bq = (K - pf.per_serving.kcal * pq - et.kcal) / bf.per_serving.kcal;
          bq = bf.name === 'Idli' ? Math.max(2, Math.min(5, Math.round(bq))) : Math.max(0.5, Math.min(2, round05(bq)));
          out.push(mk([{ food: bf, qty: bq }, { food: pf, qty: pq }, ...extra]));
        }),
      ),
    );
  } else {
    [...byRole('sp'), ...byRole('bp')].forEach((pf) =>
      [...byRole('f'), null].forEach((ff) => {
        const pq = qFor(pf, P, own(MAXQ, pf.name) || 1.5);
        out.push(mk(ff ? [{ food: pf, qty: pq }, { food: ff, qty: 1 }] : [{ food: pf, qty: pq }]));
      }),
    );
  }
  // best version of each main protein first, so every page shows different protein sources
  const ranked = out.sort((a, b) => a.score - b.score);
  const pi = info.meal === 'Breakfast' ? 1 : 0;
  const seen = new Set<string>();
  const firsts = ranked.filter((c) => {
    const k = (c.items[pi] as MealIdeaItem<T>).food.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const first = new Set(firsts);
  const seen2 = new Set<string>();
  const rest = ranked.filter((c) => {
    if (first.has(c)) return false;
    const k = c.items.map((x) => x.food.name).join('+');
    if (seen2.has(k)) return false;
    seen2.add(k);
    return true;
  });
  const list = [...firsts, ...rest];
  // keep ideas that reach at least 85% of the protein target ahead of the rest
  return [...list.filter((c) => c.protein_g >= P * 0.85), ...list.filter((c) => c.protein_g < P * 0.85)];
}

const FAST_PROTEINS: readonly [string, readonly number[]][] = [
  ['Paneer', [1, 1.5]],
  ['Greek yogurt, plain', [1, 2]],
  ['Curd / dahi', [1, 2]],
  ['Toned milk', [1, 1.5]],
  ['Peanuts, roasted', [1]],
];
const FAST_CARBS: Readonly<Record<'Snacks' | 'Breakfast' | 'Main', readonly [string, readonly number[]][]>> = {
  Snacks: [
    ['Makhana, roasted', [1, 2]],
    ['Fruit bowl', [1]],
  ],
  Breakfast: [
    ['Fruit bowl', [1]],
    ['Sweet potato, boiled', [1, 1.5]],
    ['Sabudana khichdi', [0.5]],
  ],
  Main: [
    ['Kuttu atta roti', [1, 2, 3]],
    ['Sabudana khichdi', [0.5, 1]],
    ['Sweet potato, boiled', [1, 1.5, 2]],
  ],
};
const FAST_SIDE = 'Buttermilk (chaas)';

/**
 * Fasting-day ideas: a fasting protein and a fasting carb at set portions (lunch and dinner add
 * buttermilk), best first, one per protein and carb pair. No diet filter, role table or caps, as in
 * the prototype. A combo with a food missing from `foods` is skipped (the prototype throws).
 * Mirrors prototype `combosFast(info)`.
 */
export function combosFast<T extends MealFood>(info: MealTarget, input: Pick<MealIdeasInput<T>, 'foods'>): MealIdea<T>[] {
  const byName = new Map<string, T>();
  for (const f of input.foods) if (!byName.has(f.name)) byName.set(f.name, f);
  const K = Math.max(info.kcal, 150);
  const P = Math.max(info.protein_g, 8);
  const out: MealIdea<T>[] = [];
  const mk = (items: MealIdeaItem<T>[]): MealIdea<T> => {
    const t = items.reduce((a, { food: f, qty: q }) => ({ kcal: a.kcal + f.per_serving.kcal * q, p: a.p + f.per_serving.protein_g * q }), { kcal: 0, p: 0 });
    return { items, kcal: t.kcal, protein_g: t.p, score: (3 * Math.max(0, P - t.p)) / P + Math.abs(t.kcal - K) / K + (2 * Math.max(0, t.kcal - K * 1.1)) / K };
  };
  const main = info.meal === 'Lunch' || info.meal === 'Dinner';
  const carbs = FAST_CARBS[info.meal === 'Snacks' ? 'Snacks' : info.meal === 'Breakfast' ? 'Breakfast' : 'Main'];
  FAST_PROTEINS.forEach(([pn, pqs]) =>
    carbs.forEach(([cn, cqs]) =>
      pqs.forEach((pq) =>
        cqs.forEach((cq) => {
          const pf = byName.get(pn);
          const cf = byName.get(cn);
          const side = byName.get(FAST_SIDE);
          if (!pf || !cf || (main && !side)) return;
          const items: MealIdeaItem<T>[] = [
            { food: pf, qty: pq },
            { food: cf, qty: cq },
          ];
          if (main && side) items.push({ food: side, qty: 1 });
          out.push(mk(items));
        }),
      ),
    ),
  );
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.score - b.score)
    .filter((c) => {
      const k = (c.items[0] as MealIdeaItem<T>).food.name + (c.items[1] as MealIdeaItem<T>).food.name;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
