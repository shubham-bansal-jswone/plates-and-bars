import { unitGrams, scannedFood } from './food';
import type { ScannedFoodResult, ScannedMissingField } from './food';
import { looksOff } from './off';

/**
 * Nutrition-label parser (#1067, slice 1). A new rule from the spike and the coordinator decision on #1067, not a
 * prototype port: the prototype has no label scan. Pure text in, draft food out; no image work and no I/O.
 * Sodium and salt are not mapped (decided 2026-10-19).
 */

/** One OCR word. `confidence` is 0 to 100, as Tesseract reports it. */
export interface LabelOcrWord {
  text: string;
  confidence?: number | undefined;
}

/** One OCR line: either `words` (joined with a space) or `text`. `confidence` (0 to 100) applies to words that have none. */
export interface LabelOcrLine {
  text?: string | undefined;
  words?: readonly LabelOcrWord[] | undefined;
  confidence?: number | undefined;
}

/** Plain OCR text (split on newlines) or a list of lines (plain strings or `LabelOcrLine`). */
export type LabelOcrInput = string | readonly (string | LabelOcrLine)[];

/** The values the parser can read. The first six map to the food (`added_sugar_g` and `fibre_g` as `UserFoodFields`); the rest are information only. */
export type LabelKey = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fibre_g' | 'added_sugar_g' | 'sugars_g' | 'saturated_fat_g' | 'trans_fat_g';

/** How sure the parser is. `high` shows filled; `medium` shows filled with a check marker; `low` (row found, not trusted) and `missing` (no row) are empty. */
export type LabelLevel = 'high' | 'medium' | 'low' | 'missing';

/** Why a field is marked. */
export type LabelNote =
  /** The row was found but its number could not be read. */
  | 'unreadable'
  /** Several columns and fewer numbers than columns: cannot tell which is which. */
  | 'ambiguous_column'
  /** The number is impossible (for example more than 100 g per 100 g). */
  | 'out_of_range'
  /** The label says "less than N g": filled with 0. */
  | 'less_than'
  /** Energy was kJ only and was converted. */
  | 'from_kj'
  /** Computed from the per-serving column and the serving weight. */
  | 'from_serving'
  /** Per 100 g and per serving disagree by more than 10 percent and more than the rounding allowed (0.5 g, 5 kcal for energy; a serving 0 or "<1 g" matches a scaled value under 1 g). */
  | 'serving_mismatch'
  /** Digits were repaired (O to 0, l to 1) or the unit was missing. */
  | 'repaired'
  /** The label wrote a dash for the value. */
  | 'dash_as_zero';

export interface LabelField {
  /** Undefined when the row is missing or not trusted. Energy is a whole number, grams are to 0.1. */
  value: number | undefined;
  level: LabelLevel;
  /** 0 to 1: OCR confidence times parse certainty (0 for a missing field). */
  confidence: number;
  notes: LabelNote[];
}

/** What a draft needs the user to check. */
export type LabelWarning =
  /** No table header found: every field is less certain. */
  | 'no_header'
  /** No "per 100 g" or "per serving" column could be told: unit left blank. */
  | 'basis_unknown'
  /** Per serving, but the serving weight could not be read: unit left blank. */
  | 'serving_grams_missing'
  /** Per serving, and the serving weight has a decimal ("32.5 g"): used for the checks, but `unit` is blank because `unitGrams` reads whole grams only. */
  | 'serving_grams_fractional'
  /** The serving is in ml over a per 100 g column, or in g over a per 100 ml column: no cross-check, every field at most medium. */
  | 'basis_serving_unit_mismatch'
  /** The "Per 100" column had no readable unit: read as 100 ml when an ml shows in the header or serving, else 100 g. Every field is at most medium. */
  | 'basis_unit_inferred'
  /** Macros do not add up to the energy (`looksOff` in off.ts). */
  | 'looks_off'
  | 'serving_mismatch'
  | 'fibre_exceeds_carbs';

/**
 * The per-serving alternative offered next to a per-100 draft ("Use per serve instead"). It has no `missing` or
 * `reviewable` (those are for the main read): the app works out which required fields are empty from `fields`
 * before it uses the alternate.
 */
export interface LabelAlternate {
  unit: string;
  /** The same shape and checks as the main read: ranges, the per 100 g cross-check, `looksOff`, fibre against carbs. */
  fields: Record<LabelKey, LabelField>;
  /** The trusted values only. */
  values: LabelValues;
  warnings: LabelWarning[];
}

/** The values a draft carries, undefined when empty. */
export type LabelValues = Partial<Record<LabelKey, number>>;

export interface LabelDraft {
  basis: 'per100' | 'per_serving' | 'unknown';
  /** "100 g", "100 ml", the serving text with "(N g)", or '' when it is not known. */
  unit: string;
  fields: Record<LabelKey, LabelField>;
  /** The trusted values only (the same numbers as `fields`, `value` set). */
  values: LabelValues;
  /** kcal, protein, carbs and fat that are empty: the app keeps Add disabled until each has a value. */
  missing: ScannedMissingField[];
  /** False when fewer than two of kcal, protein, carbs, fat were read: skip the review and offer "Try again" or "Type it in". */
  reviewable: boolean;
  warnings: LabelWarning[];
  /** The serving weight in grams when it was read (may have a decimal), else null. */
  servingGrams: number | null;
  /** The per-serving read, when the label has both a per 100 g and a per serving column. */
  alternate?: LabelAlternate;
}

const KEYS: readonly LabelKey[] = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'added_sugar_g', 'sugars_g', 'saturated_fat_g', 'trans_fat_g'];
const REQUIRED: readonly ScannedMissingField[] = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];
const KCAL_PER_KJ = 4.184;
const HIGH = 0.8;
const MEDIUM = 0.5;
const MAX_UNIT = 100;
const KJ_MIN = 10;
/** Per 100 g against the serving, scaled by its weight: within this ratio the rows agree (rounding), and above it the columns are swapped or misread. */
const MISMATCH_TOLERANCE = 0.1;
/**
 * A mismatch past this ratio is a column swap: swapped columns differ by (100 / serving g) squared, about 11x
 * at 30 g, while rounding stays within 10 percent. Between the two, the value is medium; past it, empty.
 */
const SWAP_RATIO = 2;

type Unit = 'kcal' | 'kj' | 'g' | 'mg' | 'mcg' | 'ml' | '%' | undefined;

/** A line with the character span and confidence (0 to 1) of each word. */
interface Line {
  text: string;
  spans: { s: number; e: number; conf: number }[];
}

interface Tok {
  value: number; // NaN when unreadable
  unit: Unit;
  lt: boolean;
  dash: boolean;
  conf: number;
  repaired: boolean;
}

interface Row {
  key: LabelKey;
  toks: Tok[];
  labelConf: number;
  defaultUnit: Unit;
  labelFixed: boolean;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;

function toLines(input: LabelOcrInput): Line[] {
  const raw: (string | LabelOcrLine)[] = typeof input === 'string' ? input.split(/\r?\n/) : [...input];
  const out: Line[] = [];
  for (const r of raw) {
    const o: LabelOcrLine = typeof r === 'string' ? { text: r } : r;
    const lineConf = o.confidence === undefined || !Number.isFinite(o.confidence) ? 1 : clamp01(o.confidence / 100);
    const words = o.words ?? [{ text: o.text ?? '' }];
    let text = '';
    const spans: Line['spans'] = [];
    for (const w of words) {
      const t = String(w.text ?? '').trim();
      if (!t) continue;
      if (text) text += ' ';
      const conf = w.confidence === undefined || !Number.isFinite(w.confidence) ? lineConf : clamp01(w.confidence / 100);
      spans.push({ s: text.length, e: text.length + t.length, conf });
      text += t;
    }
    if (text) out.push({ text, spans });
  }
  return out;
}

/** Lowest confidence of the words that overlap [s, e); 1 when none. */
function confAt(l: Line, s: number, e: number): number {
  let c = 1;
  for (const w of l.spans) if (w.s < e && w.e > s) c = Math.min(c, w.conf);
  return c;
}

const mask = (text: string, re: RegExp): string => text.replace(re, (m) => ' '.repeat(m.length));

interface Label {
  key: LabelKey | null;
  end: number;
  start: number;
  fixed: boolean;
  /** The line is a row whose number sits before the label ("Includes 5g Added Sugars"). */
  wide: boolean;
}

const SUB = String.raw`(?:of\s+which\s+|includes?\s+)?`;
const LABELS: { key: LabelKey; re: RegExp }[] = [
  { key: 'sugars_g', re: new RegExp(String.raw`^${SUB}(?:tota[l1]\s+)?sug[a-z]*\b`) },
  { key: 'saturated_fat_g', re: new RegExp(String.raw`^${SUB}(?:saturated|saturates|sat\b\.?)(?:\s+fat(?:ty\s+acids?)?)?`) },
  { key: 'trans_fat_g', re: /^trans\b(?:\s+fat(?:ty\s+acids?)?)?/ },
  { key: 'kcal', re: /^(?:energy(?:\s+value)?|en[e3]rgy|calor[i1l]es?|cal)\b\.?/ },
  { key: 'protein_g', re: /^(?:tota[l1]\s+)?pr[o0]te[i1l]ns?\b/ },
  { key: 'carbs_g', re: /^(?:tota[l1]\s+)?carb[a-z]*/ },
  { key: 'fat_g', re: /^(?:tota[l1]\s+)?fats?\b/ },
  { key: 'fibre_g', re: /^(?:dietary\s+)?f[i1l]b(?:re|er)s?\b/ },
];

function labelOf(text: string): Label | null {
  const lead = text.search(/[A-Za-z0-9]/);
  if (lead < 0) return null;
  const lower = text.toLowerCase();
  // "Calories from fat" and the old "Fat Cal." are not the energy or fat row.
  if (/^\W*(?:(?:calories|energy)\s+from|fat\s+cal)/.test(lower)) return null;
  const added = /added\s*sug[a-z]*/.exec(lower);
  if (added) return { key: 'added_sugar_g', start: added.index, end: added.index + added[0].length, fixed: false, wide: true };
  const s = lower.slice(lead);
  for (const { key, re } of LABELS) {
    const m = re.exec(s);
    if (m) {
      const fixed = /[013]/.test(m[0]) && key !== 'carbs_g';
      return { key, start: lead, end: lead + m[0].length, fixed, wide: false };
    }
  }
  return null;
}

const TOKEN = /([<≤]\s*)?(?:(nil|nill|trace|traces)(?![A-Za-z])|([0-9OoIl][0-9OoIl.,]*?)\s*(kcal|kj|cal|mcg|µg|μg|ug|mg|gms?|grams?|g|ml|%)(?![A-Za-z])|([0-9OoIl][0-9OoIl.,]*[0-9OoIl]|[0-9OoIl])(?![A-Za-z]))/gi;

function unitOf(u: string | undefined): Unit {
  if (!u) return undefined;
  const l = u.toLowerCase();
  if (l === 'kcal' || l === 'cal') return 'kcal';
  if (l === 'kj') return 'kj';
  if (l === 'mg') return 'mg';
  if (l === 'mcg' || l === 'ug' || l === 'µg' || l === 'μg') return 'mcg';
  if (l === 'ml') return 'ml';
  if (l === '%') return '%';
  return 'g';
}

/** A number as OCR wrote it, with letter slips repaired; NaN when it is not a number. */
function readNumber(raw: string, kj = false): { v: number; repaired: boolean } {
  const fixed = raw.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
  // A leading-zero integer ("05") has probably lost its decimal point, so it is a repair too.
  const repaired = fixed !== raw || /^0\d+$/.test(fixed);
  let s = fixed;
  // kJ: a dot can be the thousands separator too ("1.046 kJ" is 1046 kJ).
  if (/^[1-9]\d{0,2},\d{3}$/.test(s) || (kj && /^[1-9]\d{0,2}\.\d{3}$/.test(s))) s = s.replace(/[,.]/, '');
  else s = s.replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return { v: NaN, repaired };
  const v = Number(s);
  // A kJ value between 0 and 10 is a lost thousands separator or a lost digit: unreadable, never 0 kcal.
  return { v: kj && v > 0 && v < KJ_MIN ? NaN : v, repaired };
}

function tokens(l: Line, from: number, text: string): Tok[] {
  const out: Tok[] = [];
  const rest = text.slice(from);
  for (const m of rest.matchAll(TOKEN)) {
    const [whole, lt, word, withUnit, unit, bare] = m;
    const at = m.index ?? 0;
    // A number does not start inside a word or another number.
    if (at > 0 && /[A-Za-z0-9.,]/.test(rest[at - 1] as string)) continue;
    const s = from + at;
    const conf = confAt(l, s, s + whole.length);
    const isLt = Boolean(lt);
    if (word) {
      out.push({ value: 0, unit: undefined, lt: isLt, dash: false, conf, repaired: false });
      continue;
    }
    const mant = (withUnit ?? bare) as string;
    const u = unitOf(unit);
    if (u === '%') continue;
    // A mantissa with no real digit is a number only as "O g" style zero.
    if (!/[0-9]/.test(mant) && !(withUnit !== undefined && /^[Oo]+$/.test(mant))) continue;
    const r = readNumber(mant, u === 'kj');
    out.push({ value: isLt ? 0 : r.v, unit: u, lt: isLt, dash: false, conf, repaired: r.repaired });
  }
  return out;
}

/** Letters that are not a unit, kcal/kJ, nil or trace: any left after removing the numbers means the line is not numbers only. */
function numbersOnly(text: string): boolean {
  const left = text.replace(TOKEN, ' ');
  return left !== text && !/\p{L}/u.test(left);
}

/** A row label with no number after it ("Protein"). */
const labelOnly = (l: Line): boolean => {
  const lab = labelOf(l.text);
  return lab !== null && (rowOf(l)?.toks.length ?? 0) === 0;
};

/** A line of mg or mcg values only, after one of the four macros: a sodium-like row whose label OCR dropped. */
function mgOnlyOnMacro(label: Line, next: Line): boolean {
  const key = labelOf(label.text)?.key;
  if (key !== 'kcal' && key !== 'protein_g' && key !== 'carbs_g' && key !== 'fat_g') return false;
  const t = tokens(next, 0, next.text);
  return t.length > 0 && t.every((x) => x.unit === 'mg' || x.unit === 'mcg');
}

/**
 * Join a label-only line with the numbers-only line after it (a row that OCR split in two). The next line must
 * hold nothing but numbers (no letters of any script, so a Hindi nutrient name blocks the join), units, kcal/kJ, % and nil/trace: a label followed by an unmapped nutrient
 * ("Protein" then "Vitamin D 2mcg") is never joined, so that label stays empty. Stacked labels
 * ("Carbohydrate", "Fat", "30", "5") are never paired either: a label whose previous line is also label-only is not joined.
 */
function joinSplit(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] as Line;
    const next = lines[i + 1];
    const prev = lines[i - 1];
    if (next && labelOnly(cur) && !(prev && labelOnly(prev)) && !labelOf(next.text) && numbersOnly(next.text) && !mgOnlyOnMacro(cur, next)) {
      out.push({ text: `${cur.text} ${next.text}`, spans: [...cur.spans, ...next.spans.map((w) => ({ ...w, s: w.s + cur.text.length + 1, e: w.e + cur.text.length + 1 }))] });
      i++;
    } else out.push(cur);
  }
  return out;
}

const sliceLine = (l: Line, a: number, b: number): Line => ({
  text: l.text.slice(a, b),
  spans: l.spans.filter((w) => w.s < b && w.e > a).map((w) => ({ s: Math.max(w.s, a) - a, e: Math.min(w.e, b) - a, conf: w.conf })),
});

const SECOND_LABEL = /(?:^|[\s,;|])(?:protein|carbohydrates?|carbs|total\s+fat|fat|energy|calories|calorie|dietary\s+fib(?:re|er)|fib(?:re|er)|trans|(?:of\s+which\s+)?(?:saturates|saturated|sugars)|total\s+sugars)\b/gi;

/** Split a line that holds two rows ("Protein 8 g Fat 24 g") where a label follows a number. */
function splitMulti(l: Line): Line[] {
  const cuts: number[] = [];
  for (const m of l.text.matchAll(SECOND_LABEL)) {
    const at = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
    const before = l.text.slice(0, at);
    // "Per 100 calories" is a column header, not an energy row after a number.
    if (at > 0 && /(?:[0-9]|\bg|\bmg|%|kcal|kj|nil)\s*[,;|]?\s*$/i.test(before) && !/\bper\s*\d*\s*$/i.test(before)) cuts.push(at);
  }
  if (cuts.length === 0) return [l];
  const bounds = [0, ...cuts, l.text.length];
  return bounds.slice(0, -1).map((a, i) => sliceLine(l, a, bounds[i + 1] as number));
}

const HEADER = /nutrition(?:al)?\s+(?:facts|information|info)|typical\s+values|amount\s+per\s+serv|per\s*100\s*(?:g|ml)|per\s*100\b|per\s+serv/i;

function rowOf(l: Line): Row | null {
  const lab = labelOf(l.text);
  if (!lab || !lab.key) return null;
  let text = l.text;
  text = mask(text, /(?:calories|energy)\s+from\s+fat.*$/i);
  text = text.replace(/less\s+than/gi, (m) => `<${' '.repeat(m.length - 1)}`);
  let from = lab.end;
  if (lab.wide) {
    // Only the number attached to the "Added Sugars" phrase: "Includes 10g Added Sugars" has it just before,
    // "Added Sugars 10 g" just after. Another number on the line (total sugars) is never read; none found is empty.
    const before = /(?:includes?|incl\.?)\s*([0-9OoIl][0-9OoIl.,]*\s*(?:mg|g)?)\s*$/i.exec(text.slice(0, lab.start));
    const keep = before ? [before.index + before[0].indexOf(before[1] as string), before.index + before[0].indexOf(before[1] as string) + (before[1] as string).length] : [lab.end, text.length];
    text = text.split('').map((c, i) => (i >= (keep[0] as number) && i < (keep[1] as number) ? c : ' ')).join('');
    from = 0;
  }
  text = mask(text, /per\s*100\s*(?:g|gm|ml)\b|per\s*serv\w*(?:\s*\(?\s*\d+(?:[.,]\d+)?\s*g\)?)?/gi);
  const toks = tokens(l, from, text);
  const rest = text.slice(from);
  if (toks.length === 0 && /^[\s\-–—_.:|]*[-–—]+[\s\-–—_.:|]*$/.test(rest)) toks.push({ value: 0, unit: undefined, lt: false, dash: true, conf: confAt(l, from, l.text.length), repaired: false });
  const unitM = /\(\s*(kcal|kj|cal|g|mg)\s*\)/i.exec(rest);
  return { key: lab.key, toks, labelConf: confAt(l, lab.start, lab.end), defaultUnit: unitM ? unitOf(unitM[1]) : lab.key === 'kcal' && /^\W*cal/i.test(l.text) ? 'kcal' : undefined, labelFixed: lab.fixed };
}

type ColKind = 'per100' | 'serve' | 'other' | 'unknown';

interface Cols {
  kinds: ColKind[];
  liquid: boolean;
  /** A "Per 100" column whose unit was not read (it is on another line or lost): g, or ml when an ml shows in the header or serving. */
  inferred: boolean;
}

function columnsOf(pre: string, servingMl: boolean): Cols {
  const header = pre;
  // A serving of 100 g or 100 ml ("Per serve (100 g)", "Serving size 100 g") is not a per 100 column.
  // Only the phrase and its quantity go: a column header merged onto the same line ("Serving size 200 g Per 100 g") stays.
  pre = pre
    .replace(/serv(?:ing|e)\s*size\s*[:\-]?\s*(?:(?!per\b)[^\n])*?\d+(?:[.,]\d+)?\s*(?:g|gm|gms|grams?|ml)\b\)?/gi, ' ')
    .replace(/(per\s*(?:serve|serving|portion)\w*)(?:\s+of\s+|\s*\((?:(?!per\b)[^)\n])*?)\s*\d+(?:[.,]\d+)?\s*(?:g|gm|gms|ml)\b\)?/gi, '$1'); // needs "of" or "(": a bare "Per serving   100g" is a column header
  const kinds: { kind: ColKind | 'pct'; idx: number }[] = [];
  let first: 'g' | 'ml' | 'none' | null = null;
  // Group 5, "Per 100 kcal", "Per 100 kJ", "Per 100 calories" or "Per 100 servings", is a column of another basis (`other`), never per 100 g.
  const re = /(%\s*(?:rda|dv|nrv|ri|rni|daily\s*values?)(?:\s*per\s*(?:serve|serving|100\s*(?:g|ml)))?|\brda\b|\bnrv\b)|(per\s*100\s*(?:k?cal|kj|calor|serv)\w*)|((?:per\s*|\/\s*)?\b100\s*(?:g|gm|gms|grams?|ml)\b|per\s*100\b(?!\s*(?:[\d.,%]|k?cal|kj|calories|serv)))|(amount\s+per\s+serving|per\s*(?:serve|serving|portion|piece|slice|bar|sachet|biscuit)\b)|(per\s*(?:container|pack|package|bottle|bag)\b)/gi;
  for (const m of pre.matchAll(re)) {
    const idx = m.index ?? 0;
    // "8 servings per container" is not a column.
    if (m[5] && /servings?\s*$/i.test(pre.slice(Math.max(0, idx - 12), idx))) continue;
    // The unit comes from the first column that is taken as per 100 (not from any "100 ml" elsewhere in the header).
    if (m[3] && first === null) first = /\d\s*(?:g|gm|gms|grams?|ml)/i.test(m[3]) ? (/ml/i.test(m[3]) ? 'ml' : 'g') : 'none';
    kinds.push({ kind: m[1] ? 'pct' : m[3] ? 'per100' : m[4] ? 'serve' : 'other', idx });
  }
  const vals = kinds.filter((k) => k.kind !== 'pct').map((k) => k.kind as ColKind);
  const out: ColKind[] = [];
  // A column named twice in a row is one column, except `other` ("Per 100 kJ   Per 100 kcal" are two).
  for (const k of vals) if (out.length === 0 || k === 'other' || out[out.length - 1] !== k) out.push(k);
  const inferred = first === 'none';
  return { kinds: out, inferred, liquid: first === 'ml' || (inferred && (servingMl || /\bml\b/i.test(header))) };
}

interface Serving {
  text: string;
  grams: number | null;
  ml: number | null;
}

function servingOf(lines: Line[]): Serving | null {
  const grab = (s: string): Serving => {
    const g = /(\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d+)?)\s*(g|gm|gms|grams?|ml)\b/i.exec(s);
    const n = g ? Number(/^\d{1,3}(?:,\d{3})+$/.test(g[1] as string) ? (g[1] as string).replace(/,/g, '') : (g[1] as string).replace(',', '.')) : NaN;
    const isMl = g ? g[2]?.toLowerCase() === 'ml' : false;
    return { text: s.trim(), grams: g && !isMl && n > 0 ? n : null, ml: g && isMl && n > 0 ? n : null };
  };
  for (const l of lines) {
    const m = /(?:serving|serve|portion)\s*size\s*[:\-]?\s*(.*)$/i.exec(l.text);
    if (m && (m[1] as string).trim()) {
      // Only the serving quantity: not a column header after it ("Per 100 g Per serve").
      const cut = (m[1] as string).replace(/\s*\bper\s*(?:100|serv|portion).*$/i, '');
      const q = /^(?:.*?)\d+(?:[.,]\d+)?\s*(?:g|gm|gms|grams?|ml)\b\)?/i.exec(cut);
      return grab(q ? q[0] : cut);
    }
  }
  for (const l of lines) {
    const m = /per\s*(?:serve|serving|portion)\s*(?:of)?\s*[:\-]?\s*\(?\s*(?:[^)\n]*?,\s*)?(\d+(?:[.,]\d+)?\s*(?:g|gm|gms|grams?|ml)\b)/i.exec(l.text);
    if (m) return grab(m[1] as string);
  }
  return null;
}

function servingUnitText(s: Serving): string {
  // A decimal weight cannot be carried by `unitGrams` (it reads whole grams), so the unit stays blank.
  if (s.grams !== null && Number.isInteger(s.grams)) {
    const t = s.text.slice(0, MAX_UNIT).trim();
    return unitGrams(t) === s.grams ? t : `${s.grams} g`;
  }
  if (s.ml !== null) return /ml/i.test(s.text) ? s.text.slice(0, MAX_UNIT).trim() : `${s.ml} ml`;
  return '';
}

interface Cand {
  value: number;
  cert: number;
  conf: number;
  notes: LabelNote[];
}
type Slot = Cand | 'unreadable' | 'ambiguous' | undefined;

/** Per column read of one row. Energy takes kcal, else kJ divided by 4.184; grams rows take g, mg, mcg or no unit. */
function readRow(r: Row, ncols: number): Slot[] {
  const slots: Slot[] = Array<Slot>(ncols).fill(undefined);
  const conf = (t: Tok[]): number => t.reduce((m, x) => Math.min(m, x.conf), r.labelConf);
  const base = (t: Tok): { cert: number; notes: LabelNote[] } => {
    const notes: LabelNote[] = [];
    let cert = r.labelFixed ? 0.9 : 1;
    if (t.repaired) { cert *= 0.75; notes.push('repaired'); }
    if (t.lt) { cert *= 0.7; notes.push('less_than'); }
    if (t.dash) { cert *= 0.75; notes.push('dash_as_zero'); }
    return { cert, notes };
  };
  if (r.key === 'kcal') {
    const usable = r.toks.filter((t) => t.unit === undefined || t.unit === 'kcal' || t.unit === 'kj');
    const kcal = usable.filter((t) => t.unit === 'kcal' || (t.unit === undefined && (r.defaultUnit === 'kcal' || r.defaultUnit === undefined)));
    const kj = usable.filter((t) => t.unit === 'kj' || (t.unit === undefined && r.defaultUnit === 'kj'));
    const bareGuess = r.defaultUnit === undefined && usable.some((t) => t.unit === undefined);
    for (let i = 0; i < ncols; i++) {
      let t: Tok | undefined;
      let fromKj = false;
      let kjPair: Tok | undefined;
      if (kcal.length >= ncols) {
        t = kcal[i];
        kjPair = kj.length >= ncols ? kj[i] : undefined;
      } else if (kcal.length === 0 && kj.length >= ncols) {
        t = kj[i];
        fromKj = true;
      }
      if (!t) {
        slots[i] = r.toks.length === 0 || usable.length === 0 ? 'unreadable' : 'ambiguous';
        continue;
      }
      if (Number.isNaN(t.value)) { slots[i] = 'unreadable'; continue; }
      const b = base(t);
      let value = t.value;
      if (fromKj) { value = value / KCAL_PER_KJ; b.notes.push('from_kj'); }
      if (kjPair && !Number.isNaN(kjPair.value) && Math.abs(kjPair.value / KCAL_PER_KJ - t.value) > 0.06 * Math.max(t.value, 1) + 2) b.cert *= 0.6;
      if (bareGuess && t.unit === undefined) b.cert *= 0.7;
      slots[i] = { value: Math.round(value), cert: b.cert, conf: conf([t, ...(kjPair ? [kjPair] : [])]), notes: b.notes };
    }
    return slots;
  }
  const toks = r.toks.filter((t) => t.unit === undefined || t.unit === 'g' || t.unit === 'mg' || t.unit === 'mcg');
  if (toks.length === 0) return slots.map(() => 'unreadable' as Slot);
  if (toks.length < ncols) return slots.map(() => 'ambiguous' as Slot);
  for (let i = 0; i < ncols; i++) {
    const t = toks[i] as Tok;
    if (Number.isNaN(t.value)) { slots[i] = 'unreadable'; continue; }
    const b = base(t);
    const div = t.unit === 'mg' ? 1000 : t.unit === 'mcg' ? 1_000_000 : 1;
    slots[i] = { value: round1(t.value / div), cert: t.unit === undefined ? b.cert * 0.9 : b.cert, conf: conf([t]), notes: b.notes };
  }
  return slots;
}

const level = (c: number): LabelLevel => (c >= HIGH ? 'high' : c >= MEDIUM ? 'medium' : 'low');

/**
 * Parse OCR text of a nutrition table into a draft custom food (#1067). Reads Indian FSSAI panels and US FDA
 * Nutrition Facts (also EU style). Prefers the per 100 g or 100 ml column; with only a per serving column the
 * draft is per serving and `unit` is the serving text with "(N g)" (as `offToUserFood` labels a serving, so
 * `unitGrams(unit)` is the serving weight); when both columns exist the per serving read is in `alternate`.
 * kJ-only energy is divided by 4.184 and rounded (as `offToUserFood`); energy is whole, grams are to 0.1.
 * Plausibility reuses `looksOff` from off.ts. Each field's confidence is the OCR word confidence times the parse
 * certainty; below 0.5 the value is left undefined (never a guess), 0.5 to 0.8 is `medium` (check marker).
 * Sodium and salt are not read. Deterministic; does no I/O.
 *
 * A new rule from the #1067 spike (no prototype function).
 */
export function parseNutritionLabel(input: LabelOcrInput): LabelDraft {
  const all = toLines(input).flatMap(splitMulti);
  const serving = servingOf(all);
  const lines = joinSplit(all);
  let headerAt = lines.findIndex((l) => HEADER.test(l.text));
  let rowsFrom = Math.max(headerAt, 0);
  let rows = collect(lines, rowsFrom);
  let noHeader = headerAt < 0;
  if (rows.length === 0 && headerAt > 0) {
    rowsFrom = 0;
    rows = collect(lines, 0);
    noHeader = true;
  }
  headerAt = rowsFrom;
  const firstRow = lines.findIndex((l, i) => i >= rowsFrom && rowOf(l) !== null);
  const pre = firstRow < 0 ? '' : lines.slice(headerAt, firstRow).map((l) => l.text).join('\n');
  const cols = columnsOf(pre, serving?.ml != null);
  let kinds = cols.kinds;
  if (kinds.length === 0) kinds = [serving && /serv(?:ing|e)\s*size/i.test(all.map((l) => l.text).join('\n')) ? 'serve' : 'unknown'];
  const n = kinds.length;
  const per100 = kinds.indexOf('per100');
  const serve = kinds.indexOf('serve');
  const primary = per100 >= 0 ? per100 : serve >= 0 ? serve : 0;
  const basis: LabelDraft['basis'] = per100 >= 0 ? 'per100' : serve >= 0 ? 'per_serving' : 'unknown';

  const slots = {} as Record<LabelKey, Slot[]>;
  const rowFound = {} as Record<LabelKey, boolean>;
  for (const r of rows) {
    if (rowFound[r.key]) continue;
    rowFound[r.key] = true;
    slots[r.key] = readRow(r, n);
  }

  const servG = serving?.grams ?? null;
  // The serving amount, in g or ml. It weighs the checks only when its unit is the basis unit (100 g with g, 100 ml with ml);
  // a g serving over a per 100 ml column, or the reverse, is not cross-checked and every field is capped at medium.
  const amt = servG ?? serving?.ml ?? null;
  const unitInferred = basis === 'per100' && cols.inferred;
  const unitMismatch = basis === 'per100' && amt !== null && (servG !== null ? cols.liquid : !cols.liquid);
  const W = unitMismatch ? null : amt;
  const limit = (k: LabelKey, perHundred: boolean): number => {
    if (k === 'kcal') return perHundred ? 950 : W ? 9.5 * W : 5000;
    return perHundred ? 100 : W ?? 1000;
  };
  const pick = (k: LabelKey, col: number): Cand | undefined => {
    const s = slots[k]?.[col];
    return s && typeof s === 'object' ? s : undefined;
  };
  const known = (k: LabelKey): boolean => rowFound[k] === true;

  /**
   * How far a per 100 g value and a per serving value are apart, compared in serving units. Rounding is allowed:
   * 0.5 g (5 kcal for energy), and a serving value of 0 or "less than 1 g" matches when the scaled per 100 g value is under 1 g.
   * Past 10 percent the value is `soft` (medium); past `SWAP_RATIO` it is a `swap` (empty).
   * Limit: a swap at a serving of about 95 to 105 g is within the 10 percent tolerance and cannot be told from rounding.
   */
  const mismatch = (k: LabelKey, p100: Cand, sv: Cand): 'none' | 'soft' | 'swap' => {
    if (W === null) return 'none';
    const exp = (p100.value * W) / 100;
    const diff = Math.abs(exp - sv.value);
    if (diff <= (k === 'kcal' ? 5 : 0.5)) return 'none';
    if (k !== 'kcal' && (sv.value === 0 || sv.notes.includes('less_than')) && exp < 1) return 'none';
    if (diff <= MISMATCH_TOLERANCE * Math.max(exp, sv.value)) return 'none';
    return Math.max(exp, sv.value) > SWAP_RATIO * Math.max(Math.min(exp, sv.value), 1e-9) ? 'swap' : 'soft';
  };

  // A whole-read column swap: each serving value is the per 100 g value scaled the other way (which a ratio test misses
  // for servings of about 71 to 141 g, where (100 / W) squared is under 2). A required field that is 0 (or "<1") in both
  // columns is neutral (skim milk has fat 0 either way); every other required field with both values must disagree in the
  // swapped direction, and at least 3 must. One field that matches normally means it is not a swap. With fewer than three
  // non-neutral fields this cannot fire, and a swap falls back to the per field check (medium with `serving_mismatch`).
  const fullSwap = ((): boolean => {
    if (per100 < 0 || serve < 0 || W === null) return false;
    let swapped = 0;
    for (const k of REQUIRED) {
      const a = pick(k, per100);
      const b = pick(k, serve);
      if (!a || !b || (a.value === 0 && b.value === 0)) continue;
      if (mismatch(k, a, b) === 'none') return false;
      const e = (a.value * 100) / W;
      if (Math.abs(b.value - e) > Math.max(0.1 * Math.max(b.value, e), ((k === 'kcal' ? 5 : 0.5) * 100) / W)) return false;
      swapped++;
    }
    return swapped >= 3;
  })();

  /**
   * One column read to fields, through the checks: serving fallback (per 100 g only), range, the per 100 g against
   * serving cross-check (`other` is the other column), `looksOff`, and fibre against carbs.
   */
  const assemble = (col: number, perHundred: boolean, other: number, warnings: LabelWarning[]): { fields: Record<LabelKey, LabelField>; values: LabelValues } => {
    const prim = {} as Record<LabelKey, { cand?: Cand; notes: LabelNote[]; extra: number; slot: Slot }>;
    for (const k of KEYS) {
      let cand = pick(k, col);
      const notes: LabelNote[] = [];
      let extra = 1;
      const ov = other >= 0 ? pick(k, other) : undefined;
      if (perHundred && other >= 0 && W !== null && !cand && ov) {
        const raw = (ov.value * 100) / W;
        cand = { value: k === 'kcal' ? Math.round(raw) : round1(raw), cert: ov.cert * 0.75, conf: ov.conf, notes: [...ov.notes, 'from_serving'] };
      } else if (cand && ov) {
        const m = fullSwap ? 'swap' : perHundred ? mismatch(k, cand, ov) : mismatch(k, ov, cand);
        if (m !== 'none') {
          extra *= m === 'swap' ? 0 : 0.7;
          notes.push('serving_mismatch');
          if (!warnings.includes('serving_mismatch')) warnings.push('serving_mismatch');
        }
      }
      if (cand && cand.value > limit(k, perHundred)) { notes.push('out_of_range'); extra = 0; }
      prim[k] = { ...(cand ? { cand } : {}), notes, extra, slot: slots[k]?.[col] };
    }
    const live = (k: LabelKey): number | undefined => (prim[k].cand && prim[k].extra > 0 ? prim[k].cand?.value : undefined);
    // Energy under 5 kcal per 100 g while the macros come to 5 kcal or more: the energy is a misread (a lost digit or a dot), so it is empty.
    // A real zero-calorie drink has macros near 0 and stays.
    const to100 = (v: number | undefined): number | undefined => (v === undefined ? undefined : perHundred ? v : W ? (v * 100) / W : undefined);
    const e100 = to100(live('kcal'));
    if (e100 !== undefined && e100 < 5 && 4 * (to100(live('protein_g')) ?? 0) + 4 * (to100(live('carbs_g')) ?? 0) + 9 * (to100(live('fat_g')) ?? 0) >= 5) {
      prim.kcal.extra = 0;
      prim.kcal.notes.push('out_of_range');
    }
    // Plausibility on per 100 g equivalents (see `looksOff`).
    const [kc, pr, ca, ft] = [live('kcal'), live('protein_g'), live('carbs_g'), live('fat_g')];
    if (kc !== undefined || pr !== undefined || ca !== undefined || ft !== undefined) {
      // Per 100 g as is; per serving scaled by the serving weight; with no weight, scaled down so the 100 g total rule cannot fire.
      const factor = perHundred ? 1 : W ? 100 / W : 0.9999 / Math.max(1, ((pr ?? 0) + (ca ?? 0) + (ft ?? 0)) / 100); // 0.9999 keeps rounding from tipping the total over 100
      const sc = (v: number | undefined): number | null => (v === undefined ? null : v * factor);
      if (looksOff(sc(kc), sc(pr), sc(ca), sc(ft))) {
        warnings.push('looks_off');
        for (const k of REQUIRED) prim[k].extra *= 0.7;
      }
    }
    const [fb, cb] = [live('fibre_g'), live('carbs_g')];
    if (fb !== undefined && cb !== undefined && fb > cb) {
      warnings.push('fibre_exceeds_carbs');
      prim.fibre_g.extra *= 0.7;
      prim.carbs_g.extra *= 0.7;
    }
    if (basis === 'unknown') for (const k of KEYS) prim[k].extra *= 0.7;
    if (noHeader) for (const k of KEYS) prim[k].extra *= 0.85;

    const fields = {} as Record<LabelKey, LabelField>;
    const values: LabelValues = {};
    for (const k of KEYS) {
      const p = prim[k];
      if (!known(k)) {
        fields[k] = { value: undefined, level: 'missing', confidence: 0, notes: [] };
      } else if (!p.cand) {
        fields[k] = { value: undefined, level: 'low', confidence: 0, notes: [p.slot === 'ambiguous' ? 'ambiguous_column' : 'unreadable'] };
      } else {
        // The level comes from the unrounded confidence: 0.495 is below 0.5 and stays empty.
        const raw = Math.min(p.cand.conf * p.cand.cert * p.extra, unitMismatch || unitInferred ? HIGH - 0.01 : 1);
        const conf = Math.round(raw * 100) / 100;
        const lv = level(raw);
        const notes = [...p.cand.notes, ...p.notes];
        if (lv === 'low') fields[k] = { value: undefined, level: 'low', confidence: conf, notes };
        else {
          fields[k] = { value: p.cand.value, level: lv, confidence: conf, notes };
          values[k] = p.cand.value;
        }
      }
    }
    return { fields, values };
  };

  const warnings: LabelWarning[] = [];
  const { fields, values } = assemble(primary, basis === 'per100', basis === 'per100' ? serve : -1, warnings);
  if (unitMismatch) warnings.push('basis_serving_unit_mismatch');
  if (unitInferred) warnings.push('basis_unit_inferred');
  if (noHeader && rows.length > 0) warnings.push('no_header');
  if (basis === 'unknown' && rows.length > 0) warnings.push('basis_unknown');

  const missing = REQUIRED.filter((k) => fields[k].value === undefined);
  const readCount = REQUIRED.length - missing.length;

  let unit: string;
  if (basis === 'per100') unit = cols.liquid ? '100 ml' : '100 g';
  else {
    unit = serving ? servingUnitText(serving) : '';
    if (basis === 'per_serving' && servG === null && !(serving?.ml)) warnings.push('serving_grams_missing');
    if (basis === 'per_serving' && servG !== null && !Number.isInteger(servG)) warnings.push('serving_grams_fractional');
  }

  const draft: LabelDraft = { basis, unit, fields, values, missing, reviewable: readCount >= 2, warnings, servingGrams: servG };
  if (basis === 'per100' && serve >= 0 && serving) {
    // A main-read warning like `serving_mismatch` also shows on the alternate, which runs the same checks against the per 100 g column.
    const altWarnings: LabelWarning[] = [];
    if (unitMismatch) altWarnings.push('basis_serving_unit_mismatch');
    if (unitInferred) altWarnings.push('basis_unit_inferred');
    if (servG !== null && !Number.isInteger(servG)) altWarnings.push('serving_grams_fractional');
    const alt = assemble(serve, false, per100, altWarnings);
    if (Object.keys(alt.values).length) draft.alternate = { unit: servingUnitText(serving), fields: alt.fields, values: alt.values, warnings: altWarnings };
  }
  return draft;
}

function collect(lines: Line[], from: number): Row[] {
  const rows: Row[] = [];
  for (let i = from; i < lines.length; i++) {
    const r = rowOf(lines[i] as Line);
    if (r) rows.push(r);
  }
  return rows;
}

/**
 * The draft as `scannedFood` input, so a label draft ends in the same validator as a barcode draft (a missing
 * value stays missing, a real 0 stays 0). `name` is typed by the user; the quantity is 1.
 *
 * A new rule from the #1067 spike (no prototype function).
 */
export function labelToScannedInput(draft: LabelDraft, name: string): Parameters<typeof scannedFood>[0] {
  return { name, kcal: draft.values.kcal, protein: draft.values.protein_g, carbs: draft.values.carbs_g, fat: draft.values.fat_g, qty: 1, unit: draft.unit };
}

/**
 * Validate a reviewed label draft through `scannedFood`, then add the label's fibre and added sugar (which
 * `scannedFood` leaves null). Values the user edited on the review screen should be put in `draft.values` first.
 * A negative, non-finite or out-of-range (above 100 g per 100 g, or the serving weight) fibre or added sugar, or
 * fibre above carbs, gives `invalid`: it is never saved.
 *
 * A new rule from the #1067 spike (no prototype function).
 */
export function labelFood(draft: LabelDraft, name: string): ScannedFoodResult {
  const r = scannedFood(labelToScannedInput(draft, name));
  if (r.kind !== 'ok') return r;
  const fibre = draft.values.fibre_g;
  const added = draft.values.added_sugar_g;
  const max = draft.basis === 'per100' ? 100 : draft.servingGrams ?? 1000;
  // Fibre and added sugar get the same checks as the four macros: finite, not negative, within range, and fibre not above carbs.
  const bad = (v: number | undefined): boolean => v !== undefined && (!Number.isFinite(v) || v < 0 || v > max);
  if (bad(fibre) || bad(added) || (fibre !== undefined && fibre > r.food.carbs_g)) return { kind: 'invalid' };
  return { ...r, food: { ...r.food, fibre_g: fibre ?? null, added_sugar_g: added ?? null } };
}
