import { num, parseNum } from './num';

/**
 * Lab reports (#1070): device-only, entered by hand. Pure rules; the app owns storage. No copy lives here:
 * tips and notices are content, picked by the codes `tipFor` and `LabResult.unitStatus` return.
 */

/** Marker keys, in prototype `MARKERS` order (the prototype uses the display name as the key; `label` has it). */
export type MarkerKey =
  | 'vitamin_d' | 'vitamin_b12' | 'iron_ferritin' | 'haemoglobin' | 'ldl' | 'hdl' | 'triglycerides'
  | 'hba1c' | 'glucose' | 'tsh' | 'creatinine' | 'alt' | 'ast' | 'uric_acid';

/** Which direction a marker has a lifestyle tip for (the keys of the prototype's `tips` object). */
export type TipSide = 'low' | 'high';

/** One way to write a unit and how to turn a value in it into the marker's canonical unit. */
interface UnitRule {
  /** Normalised spellings (see `normaliseUnit`). */
  readonly names: readonly string[];
  readonly toCanonical: (x: number) => number;
}

export interface Marker {
  readonly key: MarkerKey;
  /** The prototype's key and display name, e.g. 'Fasting glucose'. */
  readonly label: string;
  readonly pattern: RegExp;
  /** The sides a tip exists for. */
  readonly tips: readonly TipSide[];
  /** The one unit the fixed red-flag thresholds are written in. */
  readonly canonicalUnit: string;
}

interface MarkerDef extends Marker {
  readonly units: (name: string) => readonly UnitRule[];
}

const id = (x: number): number => x;
const by = (k: number) => (x: number): number => x * k;
const same = (...names: string[]): UnitRule => ({ names, toCanonical: id });
const times = (k: number, ...names: string[]): UnitRule => ({ names, toCanonical: by(k) });

const MGDL = 'mg/dl';
const CHOL = [same(MGDL), times(38.67, 'mmol/l')];

/**
 * The 14 markers, in prototype order (first regex match wins). Patterns are the prototype's, unchanged.
 * Canonical units and conversions are new (the prototype keeps whatever unit the lab printed): glucose
 * mmol/L x 18, cholesterol mmol/L x 38.67, triglycerides mmol/L x 88.57, creatinine umol/L / 88.4, uric acid
 * umol/L / 59.48, HbA1c mmol/mol by the NGSP/IFCC master equation, haemoglobin g/L / 10, vitamin D nmol/L / 2.496,
 * B12 pmol/L x 1.355. Iron / ferritin has two measurands: ferritin in ng/mL (ug/L), serum iron in ug/dL.
 */
const DEFS: readonly MarkerDef[] = [
  { key: 'vitamin_d', label: 'Vitamin D', pattern: /vit(amin)?\s*d|25.?oh/i, tips: ['low'], canonicalUnit: 'ng/mL', units: () => [same('ng/ml', 'ug/l'), times(1 / 2.496, 'nmol/l')] },
  { key: 'vitamin_b12', label: 'Vitamin B12', pattern: /b\s*-?12|cobalamin/i, tips: ['low'], canonicalUnit: 'pg/mL', units: () => [same('pg/ml', 'ng/l'), times(1.355, 'pmol/l')] },
  {
    key: 'iron_ferritin', label: 'Iron / ferritin', pattern: /ferritin|serum iron|^iron/i, tips: ['low'], canonicalUnit: 'ng/mL',
    units: (n) => (/ferritin/i.test(n) ? [same('ng/ml', 'ug/l')] : [same('ug/dl'), times(5.585, 'umol/l')]),
  },
  { key: 'haemoglobin', label: 'Haemoglobin', pattern: /ha?emoglobin|^hb\b/i, tips: ['low'], canonicalUnit: 'g/dL', units: () => [same('g/dl', 'gm/dl', 'gm%', 'g%'), times(0.1, 'g/l')] },
  { key: 'ldl', label: 'LDL cholesterol', pattern: /ldl/i, tips: ['high'], canonicalUnit: 'mg/dL', units: () => CHOL },
  { key: 'hdl', label: 'HDL cholesterol', pattern: /hdl/i, tips: ['low'], canonicalUnit: 'mg/dL', units: () => CHOL },
  { key: 'triglycerides', label: 'Triglycerides', pattern: /triglycer/i, tips: ['high'], canonicalUnit: 'mg/dL', units: () => [same(MGDL), times(88.57, 'mmol/l')] },
  {
    key: 'hba1c', label: 'HbA1c', pattern: /hba1c|glycated/i, tips: ['high'], canonicalUnit: '%',
    units: () => [same('%'), { names: ['mmol/mol'], toCanonical: (x) => 0.09148 * x + 2.152 }],
  },
  { key: 'glucose', label: 'Fasting glucose', pattern: /glucose|fbs|blood sugar/i, tips: ['high'], canonicalUnit: 'mg/dL', units: () => [same(MGDL), times(18, 'mmol/l')] },
  { key: 'tsh', label: 'TSH (thyroid)', pattern: /tsh/i, tips: ['high', 'low'], canonicalUnit: 'mIU/L', units: () => [same('miu/l', 'uiu/ml', 'mu/l', 'uu/ml')] },
  { key: 'creatinine', label: 'Creatinine', pattern: /creatinine/i, tips: ['high'], canonicalUnit: 'mg/dL', units: () => [same(MGDL), times(1 / 88.4, 'umol/l')] },
  { key: 'alt', label: 'ALT (liver)', pattern: /sgpt|alt\b|alanine/i, tips: ['high'], canonicalUnit: 'U/L', units: () => [same('u/l', 'iu/l')] },
  { key: 'ast', label: 'AST (liver)', pattern: /sgot|ast\b|aspartate/i, tips: ['high'], canonicalUnit: 'U/L', units: () => [same('u/l', 'iu/l')] },
  { key: 'uric_acid', label: 'Uric acid', pattern: /uric/i, tips: ['high'], canonicalUnit: 'mg/dL', units: () => [same(MGDL), times(1 / 59.48, 'umol/l')] },
];

/** The 14 markers (prototype `MARKERS`). */
export const MARKERS: readonly Marker[] = DEFS;

/**
 * Word-bounded name patterns, used by `markerOf` (decided in #1075). Same markers and order as the prototype's
 * patterns, but a marker word must stand on its own: "Breast" is not AST, "VLDL" is not LDL, "Salt" is not ALT.
 * "Glucose PP" still matches glucose. Glycated haemoglobin goes to HbA1c, not haemoglobin (the prototype's
 * order sends it to haemoglobin).
 */
const WORD: Readonly<Record<MarkerKey, RegExp>> = {
  vitamin_d: /\bvit(amin)?\s*d\d?\b|\b25.?oh/i,
  vitamin_b12: /\bb\s*-?12\b|\bcobalamin/i,
  iron_ferritin: /\bferritin|\bserum iron\b|^iron\b/i,
  haemoglobin: /^(?!.*(glycat|a1c)).*\bha?emoglobin\b|^hb\b/i,
  ldl: /\bldl\b/i,
  hdl: /\bhdl\b/i,
  triglycerides: /\btriglycer/i,
  hba1c: /\bhba1c|\bglycated/i,
  glucose: /\bglucose\b|\bfbs\b|\bblood sugar\b/i,
  tsh: /\btsh\b/i,
  creatinine: /\bcreatinine\b/i,
  alt: /\bsgpt\b|\balt\b|\balanine/i,
  ast: /\bsgot\b|\bast\b|\baspartate/i,
  uric_acid: /\buric\b/i,
};

/**
 * The first marker whose word-bounded pattern matches the printed test name, or null. Tighter than the prototype
 * (it matched inside words: "Breast" was AST, "VLDL" was LDL); see #1075. `markerOfPrototype` is the exact prototype.
 *
 * Deviates from prototype `markerOf(name)` (tips are content; `tips` lists the sides that have one).
 */
export function markerOf(name: string): Marker | null {
  return DEFS.find((d) => WORD[d.key].test(name)) ?? null;
}

/** The prototype's `markerOf(name)` exactly, with its loose patterns. Used by `labFlagRaw`; kept so tests can compare with the prototype. */
export function markerOfPrototype(name: string): Marker | null {
  return DEFS.find((d) => d.pattern.test(name)) ?? null;
}

/** Result of `labFlag`: `red` goes to a doctor soon; `none` means the lab printed no range. */
export type LabFlag = 'red' | 'high' | 'low' | 'ok' | 'none';

/** A value with no lab range, a unit nothing is known about, or a unit known and converted. */
export type UnitStatus = 'none' | 'canonical' | 'converted' | 'unrecognised';

type Rule = (v: number, lo: number | null, hi: number | null) => boolean;

/** Red-flag rules by marker, on canonical units. Mirrors prototype `RED`. */
const RED: Readonly<Record<MarkerKey, Rule>> = {
  hba1c: (v) => v >= 9,
  glucose: (v) => v >= 200 || v < 55,
  haemoglobin: (v) => v < 8,
  tsh: (v) => v > 10 || v < 0.1,
  creatinine: (v, _lo, hi) => hi != null && v > hi * 2,
  alt: (v, _lo, hi) => hi != null && v > hi * 3,
  ast: (v, _lo, hi) => hi != null && v > hi * 3,
  vitamin_d: () => false,
  vitamin_b12: () => false,
  iron_ferritin: () => false,
  hdl: () => false,
  ldl: (v) => v >= 190,
  triglycerides: (v) => v >= 500,
  uric_acid: (v, _lo, hi) => hi != null && v > hi * 1.5,
};

/** A test as entered: strings, as the user typed them. Prototype `LabTest`. `low` and `high` are '' when the lab printed none. */
export interface LabTest {
  /** As printed. */
  name: string;
  value: string;
  unit: string;
  low: string;
  high: string;
}

/** One saved report (device only). Prototype record `lab|<date>|<id>`. */
export interface LabReport {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  tests: LabTest[];
}

/** The device-local lab hold (prototype `settings.labHold`). Never synced. */
export interface LabHold {
  on: boolean;
  /** Date the hold was set. */
  since?: string;
}

/** The prototype's bound read: '' or null is no range, anything else goes through `num` (junk reads as 0). */
const bound = (s: string | null | undefined): number | null => (s === '' || s == null ? null : num(s));

/** The strict read used by `labResult`: a blank or non-numeric bound is no range (#1075). */
const strictBound = (s: string | null | undefined): number | null => parseNum(s);

/** Flag for a value against a lab range, by the prototype's rules. `rule` is the marker's red rule, if any. */
function flagOf(v: number, lo: number | null, hi: number | null, rule: Rule | undefined, allowRed: boolean): LabFlag {
  const red = rule ? rule(v, lo, hi) : (hi != null && v > hi * 2) || (lo != null && v < lo * 0.5);
  if (allowRed && red && ((hi != null && v > hi) || (lo != null && v < lo) || rule)) return 'red';
  if (hi != null && v > hi) return 'high';
  if (lo != null && v < lo) return 'low';
  return lo != null || hi != null ? 'ok' : 'none';
}

/**
 * The prototype's flag, with no unit handling: the raw numbers are compared as typed, whatever the unit.
 * Pins its quirks (the prototype's, kept here exactly; `labFlag` and `labResult` deviate, see #1075): a blank or
 * junk value reads as 0 (`num`), so a blank glucose is `red`; a junk bound reads as 0, not as "no range". It also
 * uses the prototype's loose name patterns (`markerOfPrototype`).
 *
 * Mirrors prototype `labFlag(t)`.
 */
export function labFlagRaw(t: Pick<LabTest, 'name' | 'value' | 'low' | 'high'>): LabFlag {
  const m = markerOfPrototype(t.name);
  return flagOf(num(t.value), bound(t.low), bound(t.high), m ? RED[m.key] : undefined, true);
}

/** Lower-cases, drops spaces and a trailing dot, and writes micro as `u` (so 'µmol/L' and 'umol/l' agree). */
export function normaliseUnit(unit: string): string {
  return unit.toLowerCase().replace(/[µμ]/g, 'u').replace(/\s+/g, '').replace(/\.$/, '').replace(/^mcg/, 'ug');
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** What a test reads as once its unit is known. */
export interface LabResult {
  flag: LabFlag;
  /** The marker the name matched, or null. */
  marker: MarkerKey | null;
  unitStatus: UnitStatus;
  /** Value and range in the marker's canonical unit when the unit is known (rounded to 4 decimals if converted); else as typed. */
  /** Null when the value was blank or not a number (the flag is then `none`). */
  value: number | null;
  low: number | null;
  high: number | null;
  /** The unit `value` is in: the canonical one when known, else what was typed. */
  unit: string;
}

/**
 * Flags a test with unit handling (new, #1070). For a matched marker the unit decides:
 * - the canonical unit, or a known unit of the same marker, is converted to canonical (value, low and high) and
 *   the prototype's rules run on the converted numbers (`unitStatus` `canonical` or `converted`);
 * - any other unit, or none, is `unrecognised`: the flag is never `red`, only `high`, `low`, `ok` or `none` by the lab's own range.
 * A test matching no marker has no canonical unit; the unit-free generic rule applies as in the prototype (`unitStatus` `none`).
 *
 * Deviates from prototype `labFlag(t)` in two ways (#1075): a blank or non-numeric value is flag `none` (the
 * prototype reads it as 0, so a blank glucose went red and started the hold), and a blank or junk bound is no range
 * (the prototype reads junk as 0). Marker names are matched with `markerOf` (word-bounded).
 */
export function labResult(t: LabTest): LabResult {
  const m = markerOf(t.name);
  const v = parseNum(t.value);
  const lo = strictBound(t.low);
  const hi = strictBound(t.high);
  const typed = t.unit.trim();
  if (v === null) return { flag: 'none', marker: m?.key ?? null, unitStatus: 'none', value: null, low: lo, high: hi, unit: typed };
  if (!m) return { flag: flagOf(v, lo, hi, undefined, true), marker: null, unitStatus: 'none', value: v, low: lo, high: hi, unit: typed };
  const def = DEFS.find((d) => d.key === m.key) as MarkerDef;
  const u = normaliseUnit(typed);
  const rule = def.units(t.name).find((r) => r.names.includes(u));
  if (!rule) return { flag: flagOf(v, lo, hi, undefined, false), marker: m.key, unitStatus: 'unrecognised', value: v, low: lo, high: hi, unit: typed };
  const unitStatus: UnitStatus = rule.toCanonical === id ? 'canonical' : 'converted';
  const conv = (x: number): number => (unitStatus === 'converted' ? round4(rule.toCanonical(x)) : x);
  const [cv, cl, ch] = [conv(v), lo == null ? null : conv(lo), hi == null ? null : conv(hi)];
  const unit = m.key === 'iron_ferritin' && !/ferritin/i.test(t.name) ? 'ug/dL' : m.canonicalUnit;
  return { flag: flagOf(cv, cl, ch, RED[m.key], true), marker: m.key, unitStatus, value: cv, low: cl, high: ch, unit };
}

/** `labResult(t).flag`. */
export function labFlag(t: LabTest): LabFlag {
  return labResult(t).flag;
}

/** Which tip the results card shows for a flagged test: red has its own notice and no tip. */
export type TipKind = 'red' | TipSide | 'generic';

/**
 * The tip to show for a flagged test, as the card picks it: `red` gets the "have a doctor review it soon" notice and no
 * lifestyle tip; otherwise the marker's `low` tip for a low flag or its `high` tip for any other flag; `generic`
 * ("outside the lab's range, discuss with your doctor") when the marker has no tip for that side or there is no marker.
 *
 * Mirrors the `tip` expression in prototype `renderLabs()`. The text is in content.
 */
export function tipFor(flag: LabFlag, marker: MarkerKey | null): TipKind {
  if (flag === 'red') return 'red';
  const side: TipSide = flag === 'low' ? 'low' : 'high';
  const m = marker ? DEFS.find((d) => d.key === marker) : undefined;
  return m && m.tips.includes(side) ? side : 'generic';
}

/** True when the flag is shown as a card: anything but `ok` and `none` (prototype `renderLabs()`'s `flagged`). */
export function isFlagged(flag: LabFlag): boolean {
  return flag !== 'ok' && flag !== 'none';
}

/** True when any test is `red`, so saving the report starts the hold. Mirrors the `red` check in prototype `lab-save`. */
export function reportIsRed(report: Pick<LabReport, 'tests'>): boolean {
  return report.tests.some((t) => labFlag(t) === 'red');
}

/**
 * The hold after saving `report` on `today`: on since `today` when any result is red, otherwise unchanged
 * (a saved clean report does not clear a hold).
 *
 * Mirrors the `lab-save` step of prototype `labSave`.
 */
export function holdAfterSave(hold: LabHold | null | undefined, report: Pick<LabReport, 'tests'>, today: string): LabHold | null {
  return reportIsRed(report) ? { on: true, since: today } : (hold ?? null);
}

/** The hold after "I've seen my doctor". Mirrors prototype `case 'lab-cleared'`. */
export function clearHold(): LabHold {
  return { on: false };
}

/** True when the hold is on. Mirrors prototype `labHoldOn()`. */
export function labHoldOn(hold: LabHold | null | undefined): boolean {
  return !!(hold && hold.on);
}

/**
 * The earlier and current values of a test across saved reports, oldest first: in each report the first test of the
 * same marker, or with the exact same name. Reports without one are skipped.
 *
 * Mirrors the `hist` step in prototype `renderLabs()` (reports passed in, sorted by key as saved).
 */
export function labHistory(reports: readonly LabReport[], test: Pick<LabTest, 'name'>): { date: string; value: string }[] {
  const m = markerOf(test.name);
  const out: { date: string; value: string }[] = [];
  for (const r of reports) {
    const x = r.tests.find((y) => {
      const ym = markerOf(y.name);
      return (ym && m && ym.key === m.key) || y.name === test.name;
    });
    if (x) out.push({ date: r.date, value: x.value });
  }
  return out;
}

/** Most tests one report keeps (prototype `onLabFile`'s `.slice(0, 80)`). */
export const LAB_TESTS_MAX = 80;

export type LabReportError =
  | 'bad_date' | 'no_tests' | 'too_many_tests'
  | 'name_missing' | 'value_not_number' | 'low_not_number' | 'high_not_number' | 'unit_too_long' | 'name_too_long';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_MAX = 100;
const NUMBER = /^-?\d+([.,]\d+)?$/;

function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The first problem with a report about to be saved, or null. A date must be a real `YYYY-MM-DD`; there is at
 * least one and at most 80 tests; each has a name, a numeric value, a bound that is empty or numeric, and a name
 * and unit of at most 100 characters.
 *
 * Mirrors the cleaning in prototype `onLabFile` (name required, numeric value, up to 80 tests, date regex); stricter on
 * numbers, because the prototype's `num` reads junk as 0 (see `labFlagRaw`). Returns a code, not copy.
 */
export function validateLabReport(r: LabReport): LabReportError | null {
  if (!isDate(r.date)) return 'bad_date';
  if (r.tests.length === 0) return 'no_tests';
  if (r.tests.length > LAB_TESTS_MAX) return 'too_many_tests';
  for (const t of r.tests) {
    if (t.name.trim() === '') return 'name_missing';
    if (t.name.length > FIELD_MAX) return 'name_too_long';
    if (!NUMBER.test(t.value.trim())) return 'value_not_number';
    if (t.low.trim() !== '' && !NUMBER.test(t.low.trim())) return 'low_not_number';
    if (t.high.trim() !== '' && !NUMBER.test(t.high.trim())) return 'high_not_number';
    if (t.unit.length > FIELD_MAX) return 'unit_too_long';
  }
  return null;
}
