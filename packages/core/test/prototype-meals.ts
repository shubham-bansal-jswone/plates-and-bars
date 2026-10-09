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
  const combos = sliceBlock(src, 'function combos(info){', '}');
  const minq = combos.split('\n').find((l) => l.trim().startsWith('const MINQ = '));
  if (!minq) throw new Error('prototype: no MINQ in combos');
  const code = [
    'let HOUR = 12, TODAY_ = "", KT = 0;',
    'const S = { date:"", day:{ meals:[] }, settings:{ protein:0, fat:0, profile:null } };',
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
