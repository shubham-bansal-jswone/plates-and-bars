import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** Prototype food row: name, unit, kcal, protein, carbs, fat (prototype `FOODS`). */
export type ProtoFoodRow = [string, string, number, number, number, number];

/** Prototype meal (an item in `day.meals`). */
export interface ProtoMeal {
  name: string;
  qty: number;
  kcal: number;
  p: number;
  c: number;
  f: number;
}

/** Prototype personal food (an item in `settings.myFoods`). */
export interface ProtoMyFood {
  name: string;
  unit: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  fib?: number;
  sug?: number;
  veg?: number;
}

export interface ProtoFood {
  S: { date: string; day: { meals: ProtoMeal[]; complete?: boolean }; settings: { kcal: number; myFoods: ProtoMyFood[] } };
  FOODS: ProtoFoodRow[];
  FIB: Record<string, [number, number]>;
  PRODUCE: Record<string, number>;
  ALIAS: Record<string, string>;
  /** `foodListHtml()`'s query and filter over `allFoods()`, returning the matching names. */
  search(q: string): string[];
  /** `case 'pick'`'s grams steps for food `name` with grams input `g` and servings `serv`. */
  pick(name: string, g: string, serv: number): { qty: number } | { err: true };
  totals(meals: ProtoMeal[]): { kcal: number; p: number; c: number; f: number };
  fibreTotals(meals: ProtoMeal[]): { fib: number; sug: number; veg: number; unknown: number };
  fibreTarget(): number;
  fibreHtml(): string;
  dayComplete(d: { meals: ProtoMeal[]; complete?: boolean }): boolean;
  /** Sets what `kcalTarget(S.date)` returns for `fibreTarget` and `fibreHtml`. */
  setKcalTarget(k: number): void;
  /** The prototype's own `kcalTarget(date)` (with `calcTargets` and `labHoldOn`) against `S.settings`. */
  realKcalTarget(date: string, settings: Record<string, unknown>): number;
  /** `case 'serv'` from servings `serv` with button step `d`. */
  serv(serv: number, d: string): number;
  /** The "high protein" badge check of `foodListHtml()` on a food row. */
  highProtein(f: ProtoFoodRow): boolean;
  /** `case 'addcustom'` with form values keyed by input id; returns the toast, added meal and saved my foods. */
  addCustom(v: Record<string, string>, save: boolean, myFoods: ProtoMyFood[]): { toast: string; meal: ProtoMeal | null; myFoods: ProtoMyFood[] };
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

function replaceOnce(s: string, from: string, to: string): string {
  if (!s.includes(from)) throw new Error(`prototype: ${JSON.stringify(from)} not found`);
  return s.replace(from, to);
}

/**
 * Runs the prototype's food rules, sliced out of the HTML, against a fake `S`: the food tables (`FOODS`
 * with its fasting-day and drinks additions, `FIB`, `PRODUCE`, `ALIAS`), `foodMatch`, `unitGrams`,
 * `totals`, `fibOf`, `produceOf`, `fibreTotals`, `fibreTarget`, `fibreHtml`, `dayComplete`, the query and
 * filter of `foodListHtml` and the grams steps of `case 'pick'`. `kcalTarget` and `whyLink` are stubbed.
 */
export function loadFood(): ProtoFood {
  const src = prototypeSource();
  const listHtml = sliceBlock(src, 'function foodListHtml(){', '}').split('\n');
  const pickLines = src.split('\n');
  const ugLine = pickLines.find((l) => l.startsWith('      const ug = unitGrams(f), g = num(FS.g)'));
  const errLine = pickLines.find((l) => l.startsWith('      if(g > 0 && !ug){ toast('));
  if (!ugLine || !errLine) throw new Error('prototype: case pick reshaped');
  const servLine = pickLines.find((l) => l.startsWith("    case 'serv': FS.serv = "));
  if (!servLine) throw new Error('prototype: case serv reshaped');
  const badge = listHtml.join('\n').match(/\$\{(f\[2\] && f\[3\]\*100\/f\[2\] >= 8) \?/);
  if (!badge) throw new Error('prototype: high-protein badge reshaped');
  const addCustom = sliceBlock(src, "    case 'addcustom': {", '    }').split('\n').slice(1, -1).join('\n').replaceAll('break;', 'return;');
  const code = [
    'const S = { date:"2026-10-08", day:{ meals:[] }, settings:{ kcal:2000, myFoods:[] } };',
    'let KT = 2000; const kcalTarget = () => KT; const whyLink = () => "";',
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const r1 = '),
    sliceBlock(src, 'const FOODS = [', '];'),
    sliceUntil(src, "FOODS.push(['Sabudana khichdi'", ');'),
    sliceLine(src, "FOODS.push(['Beer'"),
    sliceBlock(src, 'const FIB = {', '};'),
    sliceLine(src, 'const PRODUCE = '),
    sliceUntil(src, 'const ALIAS = {', '};'),
    sliceLine(src, "Object.assign(ALIAS, { 'Beer'"),
    sliceLine(src, 'function allFoods(){'),
    sliceLine(src, 'const foodMatch = '),
    sliceLine(src, 'const unitGrams = '),
    sliceBlock(src, 'function totals(meals = S.day.meals){', '}'),
    sliceBlock(src, 'function fibOf(m){', '}'),
    sliceLine(src, 'function produceOf(m){'),
    sliceBlock(src, 'function fibreTotals(meals){', '}'),
    sliceLine(src, 'const fibreTarget = '),
    sliceBlock(src, 'function fibreHtml(){', '}'),
    sliceBlock(src, 'function dayComplete(d){', '}'),
    'function search(q0){ const FS = { q:q0 };',
    ...['  const q = ', '  const list = allFoods()'].map((p) => {
      const l = listHtml.find((x) => x.startsWith(p));
      if (l === undefined) throw new Error(`prototype: foodListHtml has no ${p}`);
      return l;
    }),
    '  return list.map(f => f[0]); }',
    'function pick(name, g0, serv){ const FS = { g:g0, serv }; const f = allFoods().find(x => x[0] === name);',
    ugLine,
    replaceOnce(errLine, 'break;', 'return { err:true };').replace(/toast\([^;]*\);/, ''),
    '  return { qty }; }',
    sliceBlock(src, 'const ACTIVITY = {', '};'),
    sliceLine(src, 'const PACE = '),
    sliceLine(src, 'const TRAIN_NET_MET = '),
    sliceLine(src, 'const bmrOf = '),
    sliceBlock(src, 'function calcTargets(p){', '}'),
    sliceLine(src, 'const labHoldOn = '),
    'const realKcalTarget = (() => {',
    sliceLine(src, 'function kcalTarget(date){'),
    '  return (date, settings) => { const keep = S.settings; S.settings = settings; try { return kcalTarget(date); } finally { S.settings = keep; } }; })();',
    'function serv(s0, d){ const FS = { serv:s0 }; const $ = () => ({}); const b = { dataset:{ d } };',
    '  ' + servLine.replace("case 'serv': ", '').replace(/ \$\('#servV'\)\.textContent = r1\(FS\.serv\); break;$/, ''),
    '  return FS.serv; }',
    `const highProtein = f => !!(${badge[1]});`,
    'function addCustom(v, save, my){ let TOAST = "", MEAL = null; const keep = S.settings.myFoods; S.settings.myFoods = my;',
    '  const $ = sel => sel === "#cfSave" ? { checked:save } : { value: v[sel.slice(1)] ?? "", focus(){} };',
    '  const toast = t => { TOAST = t; }, addMeal = m => { MEAL = m; }, saveSoon = () => {}, render = () => {}, sheet = { close(){} };',
    '  (() => {',
    addCustom,
    '  })();',
    '  const out = { toast:TOAST, meal:MEAL, myFoods:S.settings.myFoods }; S.settings.myFoods = keep; return out; }',
    'return { S, FOODS, FIB, PRODUCE, ALIAS, search, pick, totals, fibreTotals, fibreTarget, fibreHtml, dayComplete, setKcalTarget: k => { KT = k; }, realKcalTarget, serv, highProtein, addCustom };',
  ].join('\n');
  return new Function(code)() as ProtoFood;
}
