import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** A prototype prep entry (`S.settings.prep` item). */
export interface ProtoPrep {
  id: string;
  name: string;
  meal: string;
  left: number;
  until: string;
  food: { kcal: number; p: number; c: number; f: number };
}

export interface ProtoPrepRules {
  /** `case 'rb-prep'` against `prep`, with the recipe's name, meal, katoris and unrounded per-katori values; returns the prep list after and the last toast. */
  add(prep: ProtoPrep[], name: string, meal: string, kat: number, per: { kcal: number; p: number; c: number; f: number } | null, today: string, id: string): { prep: ProtoPrep[]; toast: string };
  /** `prepLineHtml(meal)` on `date`, read back as the batch ids offered and their lines. */
  line(prep: ProtoPrep[], meal: string, date: string): { ids: string[]; texts: string[] };
  /** `case 'prep-log'` for batch `id`; returns the prep list after and the meal it logged (null when nothing was logged). */
  log(prep: ProtoPrep[], id: string): { prep: ProtoPrep[]; meal: { meal: string; name: string; qty: number; kcal: number; p: number; c: number; f: number } | null };
}

/** Runs the prototype's meal-prep code, sliced out of the HTML, against a fake `S`. */
export function loadPrep(): ProtoPrepRules {
  const src = prototypeSource();
  const lines = src.split('\n');
  const logLine = lines.find((l) => l.startsWith("    case 'prep-log': {"));
  if (!logLine) throw new Error('prototype: case prep-log reshaped');
  const prepBlock = sliceBlock(src, "    case 'rb-prep': {", '    }').split('\n').slice(1, -1).join('\n').replaceAll('break;', 'return;');
  const code = [
    'const S = { date:"", settings:{ prep:[] }, day:{ meals:[] } };',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const r1 = '),
    sliceBlock(src, 'function prepLineHtml(meal){', '}'),
    'const copy = x => JSON.parse(JSON.stringify(x));',
    'function add(prep, name, meal, kat, per, today, id){ S.settings = { prep: copy(prep) }; let TOAST = "";',
    '  const RB = { name }, FS = { meal }, rbTotals = () => ({ per, kat }), newId = () => id, TODAY = () => today;',
    '  const toast = t => { TOAST = t; }, $ = () => ({ click(){} }), sheet = { close(){} }, renderFood = () => {}, saveSoon = () => {};',
    '  (() => {',
    prepBlock,
    '  })();',
    '  return { prep:S.settings.prep, toast:TOAST }; }',
    'function line(prep, meal, date){ S.settings = { prep: copy(prep) }; S.date = date; const h = prepLineHtml(meal);',
    '  return { ids:[...h.matchAll(/data-v="([^"]*)"/g)].map(m => m[1]), texts:[...h.matchAll(/<span>([^<]*)<\\/span>/g)].map(m => m[1]) }; }',
    'function log(prep, id){ S.settings = { prep: copy(prep) }; S.day = { meals:[] }; const b = { dataset:{ v:id } }, newId = () => "log-id", saveDay = () => {}, saveSoon = () => {}, renderFood = () => {}, toast = () => {};',
    '  switch("prep-log"){',
    logLine.replaceAll('return;', 'break;'),
    '  }',
    '  return { prep:S.settings.prep, meal:S.day.meals[0] || null }; }',
    'return { add, line, log };',
  ].join('\n');
  return new Function(code)() as ProtoPrepRules;
}
