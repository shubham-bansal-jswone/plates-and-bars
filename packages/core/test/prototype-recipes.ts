import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** Prototype ingredient row (an item in `RB.rows` or a kitchen test's `rows`). */
export interface ProtoRow {
  ing: string;
  amt: string;
  unit: string;
}

/** Prototype recipe-builder state (`RB`), the fields the rules read. */
export interface ProtoRB {
  name: string;
  rows: ProtoRow[];
  ymode: string;
  katoris: string;
  grams: string;
  preset: string;
  oil: string;
  log: number;
  editing: number | null;
}

/** Prototype personal food saved by a recipe or kitchen test. */
export interface ProtoBuiltFood {
  name: string;
  unit: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fib: number;
  sug: number;
  veg?: number;
  recipe?: boolean;
  kitchen?: boolean;
}

/** Prototype kitchen test (`KT.d`). */
export interface ProtoKitchenTest {
  id: string;
  name: string;
  rows: ProtoRow[];
  pot: string;
  potFull: string;
  cooked: string;
  serving: string;
  sname: string;
}

export interface ProtoRecipes {
  RAW: Record<string, [number, number, number, number]>;
  RAW_FIB: Record<string, number>;
  PRESETS: Record<string, { rows: [string, number][]; k: number }>;
  /** `rbTotals()` with `RB` set to `rb`. */
  rbTotals(rb: Partial<ProtoRB>): { t: { kcal: number; p: number; c: number; f: number; g: number }; kat: number; per: { kcal: number; p: number; c: number; f: number } | null };
  /** `rbFromPreset(k)` at oil level `oil`; returns `RB.rows`. */
  rbFromPreset(k: string, oil: string): ProtoRow[];
  /** `recipeAction(a, { dataset })` with `RB` set to `rb` and `myFoods`, `recipes` in settings. */
  recipeAction(
    a: string,
    dataset: Record<string, string>,
    rb: Partial<ProtoRB>,
    settings: { myFoods: ProtoBuiltFood[]; recipes: unknown[] },
  ): { toast: string; RB: ProtoRB; settings: { myFoods: ProtoBuiltFood[]; recipes: { name: string; rows: ProtoRow[] }[] }; meal: unknown };
  ktCalc(d: ProtoKitchenTest): {
    t: { kcal: number; p: number; c: number; f: number; fib: number; oil: number; g: number };
    ready: boolean;
    cooked?: number;
    per100?: { kcal: number; p: number; c: number; f: number; fib: number };
    perServ?: { kcal: number; p: number; c: number; f: number; fib: number; oil: number; g: number } | null;
    servings?: number | null;
  };
  /** `ktSave(use)` on `d`, no photo; returns the toast and settings after. */
  ktSave(d: ProtoKitchenTest, use: boolean, myFoods: ProtoBuiltFood[]): { toast: string; myFoods: ProtoBuiltFood[]; kitchen: ProtoKitchenTest[] };
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
 * Runs the prototype's recipe builder and kitchen-test rules, sliced out of the HTML: `RAW` (with its
 * fasting-day additions), `RAW_FIB`, `FATTY`, `UNIT_G`, `KATORI_G`, `PRESETS`, `OIL_LEVEL`, `RB`,
 * `rbReset`, `rbFromPreset`, `rbTotals`, `recipeAction`, `KT`, `ktCalc` and `ktSave`. UI calls are stubbed.
 */
export function loadRecipes(): ProtoRecipes {
  const src = prototypeSource();
  const code = [
    'const S = { settings:{ myFoods:[], recipes:[], kitchen:[] } };',
    'let TOAST = "", MEAL = null;',
    'const toast = t => { TOAST = t; }, addMeal = m => { MEAL = m; }, saveSoon = () => {}, render = () => {}, renderFoodSheet = () => {}, sheet = { close(){} };',
    'const PDB = { put: async () => {}, del(){} }, compressPhoto = async () => null;',
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const r1 = '),
    sliceBlock(src, 'const RAW = {', '};'),
    sliceUntil(src, "Object.assign(RAW, { 'Sabudana'", '});'),
    sliceLine(src, 'const FATTY = '),
    sliceLine(src, 'const UNIT_G = '),
    sliceLine(src, 'const KATORI_G = '),
    sliceBlock(src, 'const PRESETS = {', '};'),
    sliceLine(src, 'const OIL_LEVEL = '),
    sliceLine(src, 'const RB = '),
    sliceLine(src, 'function rbReset(){'),
    sliceBlock(src, 'function rbFromPreset(k){', '}'),
    sliceBlock(src, 'function rbTotals(){', '}'),
    sliceBlock(src, 'function recipeAction(a, b){', '}'),
    sliceUntil(src, 'const RAW_FIB = {', '};'),
    sliceLine(src, 'const KT = '),
    sliceBlock(src, 'function ktCalc(d){', '}'),
    sliceBlock(src, 'async function ktSave(use){', '}'),
    'const setRB = rb => { rbReset(); Object.assign(RB, JSON.parse(JSON.stringify(rb))); };',
    'return {',
    '  RAW, RAW_FIB, PRESETS,',
    '  rbTotals(rb){ setRB(rb); return rbTotals(); },',
    '  rbFromPreset(k, oil){ rbReset(); RB.oil = oil; rbFromPreset(k); return JSON.parse(JSON.stringify(RB.rows)); },',
    '  recipeAction(a, dataset, rb, settings){ setRB(rb); S.settings = JSON.parse(JSON.stringify({ ...settings, kitchen:[] })); TOAST = ""; MEAL = null;',
    '    recipeAction(a, { dataset }); return { toast:TOAST, RB:JSON.parse(JSON.stringify(RB)), settings:S.settings, meal:MEAL }; },',
    '  ktCalc,',
    '  ktSave(d, use, myFoods){ S.settings = { myFoods: JSON.parse(JSON.stringify(myFoods)), recipes:[], kitchen:[] }; KT.d = JSON.parse(JSON.stringify(d)); KT.photo = null; TOAST = "";',
    '    ktSave(use); return { toast:TOAST, myFoods:S.settings.myFoods, kitchen:S.settings.kitchen }; },',
    '};',
  ].join('\n');
  return new Function(code)() as ProtoRecipes;
}
