import { prototypeSource, sliceBlock, sliceLine } from './helpers';
import type { ProtoFoodRow, ProtoMeal } from './prototype-food';

/** A prototype combo: `[food row, servings]` items and unrounded totals. */
export interface ProtoCombo {
  items: [ProtoFoodRow, number][];
  kcal: number;
  p: number;
  fat?: number;
  score: number;
}

/** Prototype meal target (`nextMealInfo()` result or a `buildPlan` info). */
export interface ProtoInfo {
  meal: string;
  kcal: number;
  p: number;
  f?: number | undefined;
  kcalLeft?: number;
  pLeft?: number;
}

/** Prototype state the sliced meal functions read. */
export interface ProtoMealState {
  date: string;
  today: string;
  hour: number;
  meals: (ProtoMeal & { meal: string })[];
  kcalTarget: number;
  settings: { diet?: string; protein: number; fat: number; profile: { age: number } | null };
}

export interface ProtoMeals {
  FOODS: ProtoFoodRow[];
  ROLE: Record<string, [string, string]>;
  MEAL_W: Record<string, number>;
  PROT_W: Record<string, number>;
  MAXQ: Record<string, number>;
  /** `MINQ`, read out of `combos` (it is local there). */
  MINQ: Record<string, number>;
  combos(info: ProtoInfo, diet: string | undefined): ProtoCombo[];
  combosFast(info: ProtoInfo): ProtoCombo[];
  nextMealInfo(state: ProtoMealState): ProtoInfo | null;
}

/** Lines from the first starting with `start` up to and including the first ending with `end`. */
function sliceUntil(src: string, start: string, end: string): string {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l.startsWith(start));
  if (from < 0) throw new Error(`prototype: no line starting with ${start}`);
  const to = lines.findIndex((l, i) => i >= from && l.endsWith(end));
  if (to < 0) throw new Error(`prototype: no line ending ${end} after ${start}`);
  return lines.slice(from, to + 1).join('\n');
}

/**
 * Runs the prototype's meal-idea rules, sliced out of the HTML: `FOODS` (with the fasting-day foods),
 * `ROLE` (with its fasting-day roles), `MEAL_W`, `PROT_W`, `MAXQ`, `dietOK`, `F`, `round05`, `combos`,
 * `combosFast`, `nextMealInfo` and `totals`. The clock (`mealByTime`, `TODAY`), `kcalTarget` and
 * `older` read the state passed in.
 */
export function loadMeals(): ProtoMeals {
  const src = prototypeSource();
  const code = [
    ...mealsCode(src),
    'const copy = x => JSON.parse(JSON.stringify(x));',
    'return {',
    '  FOODS, ROLE, MEAL_W, PROT_W, MAXQ, MINQ,',
    '  combos(info, diet){ S.settings = { diet }; return combos(copy(info)); },',
    '  combosFast(info){ return combosFast(copy(info)); },',
    '  nextMealInfo(st){ HOUR = st.hour; TODAY_ = st.today; KT = st.kcalTarget; S.date = st.date; S.day = { meals: copy(st.meals) }; S.settings = copy(st.settings); return nextMealInfo(); },',
    '};',
  ].join('\n');
  return new Function(code)() as ProtoMeals;
}

/** The prototype's meal-idea code and the stubs it needs, as lines to run. */
function mealsCode(src: string): string[] {
  const combos = sliceBlock(src, 'function combos(info){', '}');
  const minq = combos.split('\n').find((l) => l.trim().startsWith('const MINQ = '));
  if (!minq) throw new Error('prototype: no MINQ in combos');
  return [
    'let HOUR = 12, TODAY_ = "", KT = 0;',
    'const S = { date:"", day:{ meals:[] }, ui:{}, settings:{ protein:0, fat:0, profile:null } };',
    'const mealByTime = () => { const h = HOUR; return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 19 ? "Snacks" : "Dinner"; };',
    'const TODAY = () => TODAY_, kcalTarget = () => KT;',
    sliceLine(src, 'const older = '),
    sliceBlock(src, 'const FOODS = [', '];'),
    sliceUntil(src, "FOODS.push(['Sabudana khichdi'", ');'),
    sliceBlock(src, 'const ROLE = {', '};'),
    sliceLine(src, "Object.assign(ROLE, { 'Sabudana khichdi'"),
    sliceLine(src, 'const MEAL_W = '),
    sliceLine(src, 'const MAXQ = '),
    sliceLine(src, 'const dietOK = '),
    sliceLine(src, 'const F = '),
    sliceLine(src, 'function round05(x){'),
    sliceBlock(src, 'function totals(meals = S.day.meals){', '}'),
    combos,
    sliceBlock(src, 'function combosFast(info){', '}'),
    sliceBlock(src, 'function nextMealInfo(){', '}'),
    minq.trim(),
  ];
}

/** Prototype weekly plan (`mealPlan`). */
export interface ProtoPlan {
  start: string;
  opts: Record<string, [string, number][][]>;
  days: Record<string, { k: number }>[];
}

export interface ProtoMealPlan {
  GROC: Record<string, [string, number, string][]>;
  /** `buildPlan()` with `S.date` and the settings targets, diet and profile (its age is read by `older`). */
  buildPlan(date: string, settings: { kcal: number; protein: number; fat: number; diet?: string; profile?: { age: number } | null }): ProtoPlan;
  /** `case 'mp-swap'` on day `i`'s meal; returns the plan after. */
  swap(plan: ProtoPlan, i: number, meal: string): ProtoPlan;
  /** `grocerySheet()` on `plan`: the sheet's rows (item and amount, as shown) and the copy text. */
  grocery(plan: ProtoPlan): { rows: [string, string][]; text: string };
  /** `planSheet()` on `plan` (as `S.ui.plan`) with user foods: each day's "About … kcal, … g protein" line. */
  planTotals(plan: ProtoPlan, myFoods: { name: string; unit: string; kcal: number; p: number; c: number; f: number }[]): string[];
  /** Whether `planSheet()` reuses a saved plan rather than building a new one, on `today`. */
  reusesSaved(plan: ProtoPlan, today: string): boolean;
  /** `planForMeal(meal)` with `S.date` and the saved plan. */
  planForMeal(plan: ProtoPlan | null, date: string, meal: string): [string, number][] | null;
}

/**
 * Runs the prototype's weekly plan and grocery list, sliced out of the HTML on top of the meal-idea
 * code: `GROC`, `buildPlan`, `planItems`, `planSheet`, `grocerySheet`, `planForMeal`, `case 'mp-swap'`,
 * with `esc`, `fmt`, `r1`, the date helpers, `foodByName` and `allFoods`. `openSheet` keeps the HTML.
 */
export function loadMealPlan(): ProtoMealPlan {
  const src = prototypeSource();
  const code = [
    ...mealsCode(src),
    'let HTML = "";',
    'const openSheet = h => { HTML = h; };',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const r1 = '),
    sliceLine(src, 'const daysBetween = '),
    sliceLine(src, 'function allFoods(){'),
    sliceLine(src, 'function foodByName(n){'),
    sliceBlock(src, 'const GROC = {', '};'),
    sliceBlock(src, 'function buildPlan(){', '}'),
    sliceLine(src, 'const planItems = '),
    sliceBlock(src, 'function planSheet(){', '}'),
    sliceBlock(src, 'function grocerySheet(){', '}'),
    sliceBlock(src, 'function planForMeal(meal){', '}'),
    `function swapAction(b, meal){ switch('mp-swap'){ ${sliceLine(src, "    case 'mp-swap':").trim()} } }`,
    'const copy = x => JSON.parse(JSON.stringify(x));',
    'const ROW = /<input type="checkbox" style="width:20px;height:20px"> (.*?)<\\/label><b>(.*?)<\\/b>/g;',
    'return {',
    '  GROC,',
    '  buildPlan(date, settings){ S.date = date; S.settings = copy(settings); return copy(buildPlan()); },',
    '  swap(plan, i, meal){ S.settings = { myFoods:[] }; S.ui = { plan: copy(plan) }; swapAction({ dataset:{ v:String(i) } }, meal); return copy(S.ui.plan); },',
    '  grocery(plan){ S.ui = { plan: copy(plan) }; HTML = ""; grocerySheet(); return { rows: [...HTML.matchAll(ROW)].map(m => [m[1], m[2]]), text: S.ui.grocText }; },',
    '  planTotals(plan, myFoods){ S.settings = { kcal:2000, protein:100, myFoods: copy(myFoods) }; S.ui = { plan: copy(plan) }; HTML = ""; planSheet(); return [...HTML.matchAll(/<p class="hint">(About [^<]*)<\\/p>/g)].map(m => m[1]); },',
    '  reusesSaved(plan, today){ TODAY_ = today; S.date = today; S.settings = { kcal:2000, protein:100, fat:60, myFoods:[], mealPlan: copy(plan) }; S.ui = {}; planSheet(); return S.ui.plan.start === plan.start && JSON.stringify(S.ui.plan) === JSON.stringify(plan); },',
    '  planForMeal(plan, date, meal){ S.date = date; S.settings = { mealPlan: plan && copy(plan) }; return planForMeal(meal); },',
    '};',
  ].join('\n');
  return new Function(code)() as ProtoMealPlan;
}
