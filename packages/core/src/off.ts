import { FOOD_NAME_MAX, unitGrams } from './food';

/**
 * Open Food Facts barcode lookup rules (v1.1, #944). New rules, not a prototype port: the prototype has no
 * barcode scan. They follow the "D4. Mapping" section of the #944 spec and the coordinator's decisions.
 */

/** A value as OFF sends it: a number, a numeric string, or absent. Anything else is read as missing. */
export type OffNumber = number | string | null | undefined;

/** The whitelisted nutriment keys of the trimmed OFF product (all per 100 g or 100 ml). Bare `energy` is kJ and is never read. */
export interface OffNutriments {
  'energy-kcal_100g'?: OffNumber;
  'energy-kj_100g'?: OffNumber;
  proteins_100g?: OffNumber;
  carbohydrates_100g?: OffNumber;
  fat_100g?: OffNumber;
  fiber_100g?: OffNumber;
  'added-sugars_100g'?: OffNumber;
  /** Total sugars. Present in raw OFF data, but never mapped to added sugar. */
  sugars_100g?: OffNumber;
}

/**
 * The trimmed OFF product the backend returns (a subset of the OFF v2 product). The contract schema is
 * added by the contract PR for #944; this local type follows the spec so the two agree.
 */
export interface OffProduct {
  code?: string | null | undefined;
  product_name?: string | null | undefined;
  brands?: string | null | undefined;
  /** Pack size text, for example "50g" or "1 l". Used only to tell a liquid from a solid. */
  quantity?: string | null | undefined;
  serving_size?: string | null | undefined;
  serving_quantity?: OffNumber;
  nutriments?: OffNutriments | null | undefined;
  /** 0 to 1. */
  completeness?: OffNumber;
  states_tags?: readonly string[] | null | undefined;
  data_quality_errors_tags?: readonly string[] | null | undefined;
  countries_tags?: readonly string[] | null | undefined;
}

/** Fields the user must fill before saving: they were missing from the database (never defaulted to 0). */
export type OffMissingField = 'name' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';

/** Why the review screen shows a data-quality warning. */
export type OffWarning =
  /** Macros do not add up to the stated energy, or exceed 100 g per 100 g: "These numbers look off. Check the pack." */
  | 'looks_off'
  /** `completeness` below 0.5. */
  | 'low_completeness'
  /** `data_quality_errors_tags` is not empty. */
  | 'quality_errors'
  /** `states_tags` has `en:nutrition-facts-to-be-completed`. */
  | 'nutrition_to_be_completed';

/** A draft user food: required numbers are null when OFF does not have them. */
export interface OffUserFoodDraft {
  name: string;
  unit: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  /** Only from `added-sugars_100g`; total `sugars` is never used. */
  added_sugar_g: number | null;
  fruit_veg_servings: null;
  origin: 'custom';
  /** The scanned code when the product carries one, else null. */
  barcode: string | null;
}

/** Result of `offToUserFood`. */
export type OffMapResult =
  /** No usable nutriment at all: treat as "not found". */
  | { kind: 'not_found' }
  | {
      kind: 'ok';
      draft: OffUserFoodDraft;
      /** Fields to leave empty and flag "Not in the database. Enter it from the pack." Save stays disabled until filled. */
      missing: OffMissingField[];
      warnings: OffWarning[];
      /** The pack measures in ml: values are per 100 ml or per serving in ml, so grams entry is off. */
      liquid: boolean;
      /** Show "Carbohydrate is as printed on the pack. Check it includes fibre." (the product is not listed for India). */
      carbsFibreHint: boolean;
    };

const KCAL_PER_KJ = 4.184;
const MAX_UNIT = 100;
const MACRO_DIFF_KCAL = 50;
const MACRO_DIFF_RATIO = 0.4;
const LOW_COMPLETENESS = 0.5;

/** A finite number at or above 0, from a number or a numeric string; else null. */
function read(v: OffNumber): number | null {
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
    v = Number(v);
  }
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const alnum = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Name: `product_name`, plus the first brand when it is not already in the name; at most 200 characters. */
function nameOf(p: OffProduct): string {
  const name = (p.product_name ?? '').trim();
  if (!name) return '';
  const brand = (p.brands ?? '').split(',')[0]?.trim() ?? '';
  const full = brand && !alnum(name).includes(alnum(brand)) ? `${name} (${brand})` : name;
  return full.slice(0, FOOD_NAME_MAX).trim();
}

/** True when the pack is measured in ml (the serving text, else the pack size, has a volume and no grams). */
function isLiquid(p: OffProduct): boolean {
  const text = (p.serving_size ?? '').trim() || (p.quantity ?? '').trim();
  return /\d\s*(?:ml|cl|dl|l|litres?|liters?)\b/i.test(text) && !/\d\s*(?:g|kg|mg)\b/i.test(text);
}

/**
 * The serving label: the `serving_size` text, with "(N g)" added when `unitGrams` would not read N from it,
 * so the grams box works. N is whole grams (the label cannot carry a decimal), at least 1. At most 100 characters.
 */
function servingUnit(text: string, grams: number, liquid: boolean): string {
  const base = text.trim() || '1 serving';
  if (liquid) return base.slice(0, MAX_UNIT).trim();
  const n = Math.max(1, Math.round(grams));
  if (unitGrams(base.slice(0, MAX_UNIT)) === n) return base.slice(0, MAX_UNIT).trim();
  const suffix = ` (${n} g)`;
  return base.slice(0, MAX_UNIT - suffix.length).trim() + suffix;
}

/**
 * Map a trimmed OFF product to a draft user food for the review screen. Per 100 g values come from the
 * `_100g` fields only; bare `energy` (kJ) is never read. Energy is `energy-kcal_100g`, or `energy-kj_100g`
 * divided by 4.184 when kcal is missing. kcal is rounded to a whole number and grams to 0.1 (as the Custom
 * tab). With `serving_quantity` above 0 the values are per serving and the label is the serving text with
 * "(N g)"; otherwise they are per 100 g ("100 ml" for liquids). Missing fields stay null and are listed in
 * `missing`; `sugars` is not mapped to added sugar. A product with no usable nutriment is `not_found`.
 *
 * A new rule from the #944 spec (rules 1 to 9); no prototype function.
 */
export function offToUserFood(p: OffProduct): OffMapResult {
  const n = p.nutriments ?? {};
  const kcal100 = read(n['energy-kcal_100g']);
  const kj100 = read(n['energy-kj_100g']);
  const energy100 = kcal100 ?? (kj100 === null ? null : kj100 / KCAL_PER_KJ);
  const protein100 = read(n.proteins_100g);
  const carbs100 = read(n.carbohydrates_100g);
  const fat100 = read(n.fat_100g);
  const fibre100 = read(n.fiber_100g);
  const sugar100 = read(n['added-sugars_100g']);
  if ([energy100, protein100, carbs100, fat100, fibre100, sugar100].every((v) => v === null)) return { kind: 'not_found' };

  const liquid = isLiquid(p);
  const servingG = read(p.serving_quantity);
  const perServing = servingG !== null && servingG > 0;
  const scale = perServing ? servingG / 100 : 1;
  const grams = (v: number | null): number | null => (v === null ? null : round1(v * scale));
  const kcal = energy100 === null ? null : Math.round(energy100 * scale);

  const draft: OffUserFoodDraft = {
    name: nameOf(p),
    unit: perServing ? servingUnit(p.serving_size ?? '', servingG, liquid) : liquid ? '100 ml' : '100 g',
    kcal,
    protein_g: grams(protein100),
    carbs_g: grams(carbs100),
    fat_g: grams(fat100),
    fibre_g: grams(fibre100),
    added_sugar_g: grams(sugar100),
    fruit_veg_servings: null,
    origin: 'custom',
    barcode: p.code ? p.code : null,
  };

  const missing: OffMissingField[] = [];
  if (!draft.name) missing.push('name');
  if (draft.kcal === null) missing.push('kcal');
  if (draft.protein_g === null) missing.push('protein_g');
  if (draft.carbs_g === null) missing.push('carbs_g');
  if (draft.fat_g === null) missing.push('fat_g');

  const warnings: OffWarning[] = [];
  if (looksOff(energy100, protein100, carbs100, fat100)) warnings.push('looks_off');
  const completeness = read(p.completeness);
  if (completeness !== null && completeness < LOW_COMPLETENESS) warnings.push('low_completeness');
  if ((p.data_quality_errors_tags ?? []).length > 0) warnings.push('quality_errors');
  if ((p.states_tags ?? []).includes('en:nutrition-facts-to-be-completed')) warnings.push('nutrition_to_be_completed');

  return { kind: 'ok', draft, missing, warnings, liquid, carbsFibreHint: !(p.countries_tags ?? []).includes('en:india') };
}

/**
 * Plausibility on per 100 g values: protein + carbs + fat above 100 g, or stated energy differing from
 * 4P + 4C + 9F by more than 50 kcal and more than 40 percent of the stated energy (all four must be known).
 */
function looksOff(kcal: number | null, p: number | null, c: number | null, f: number | null): boolean {
  if ((p ?? 0) + (c ?? 0) + (f ?? 0) > 100) return true;
  if (kcal === null || p === null || c === null || f === null) return false;
  const diff = Math.abs(kcal - (4 * p + 4 * c + 9 * f));
  return diff > MACRO_DIFF_KCAL && diff > MACRO_DIFF_RATIO * kcal;
}

/** The barcode formats `validateBarcode` accepts. */
export type BarcodeFormat = 'EAN-8' | 'EAN-13' | 'UPC-A' | 'UPC-E';

/** Result of `validateBarcode`. */
export type BarcodeCheck =
  | { ok: true; format: BarcodeFormat; code: string }
  | { ok: false; reason: 'not_digits' | 'length' | 'check_digit' };

/** GS1 check digit for the digits before it: weights 3, 1, 3, ... from the right. */
function gs1Check(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

const checkOk = (code: string): boolean => gs1Check(code.slice(0, -1)) === Number(code[code.length - 1]);

/** The 12-digit UPC-A a UPC-E (8 digits, number system 0 or 1) stands for; the check digit carries over. */
function upcEToA(e: string): string {
  const d = e.split('');
  const ns = d[0], last = d[6], chk = d[7];
  const [, a, b, c, dd, ee] = d;
  let body: string;
  if (last === '0' || last === '1' || last === '2') body = `${a}${b}${last}0000${c}${dd}${ee}`;
  else if (last === '3') body = `${a}${b}${c}00000${dd}${ee}`;
  else if (last === '4') body = `${a}${b}${c}${dd}00000${ee}`;
  else body = `${a}${b}${c}${dd}${ee}0000${last}`;
  return `${ns}${body}${chk}`;
}

/**
 * Validate a scanned or typed barcode: digits only (no trimming; leading zeros kept as typed), 8, 12 or 13
 * long, with a correct GS1 check digit. Eight digits are EAN-8, or UPC-E when the EAN-8 check fails but the
 * code starts with 0 or 1 and its UPC-A expansion checks out (a UPC-E ending in 5 to 9 has the same check
 * digit under both rules, so it reads as EAN-8; both are valid scans). Other lengths (including 14) are `length`.
 *
 * A new rule from the #944 spec; no prototype function.
 */
export function validateBarcode(code: string): BarcodeCheck {
  if (!/^[0-9]+$/.test(code)) return { ok: false, reason: 'not_digits' };
  if (code.length === 13) return checkOk(code) ? { ok: true, format: 'EAN-13', code } : { ok: false, reason: 'check_digit' };
  if (code.length === 12) return checkOk(code) ? { ok: true, format: 'UPC-A', code } : { ok: false, reason: 'check_digit' };
  if (code.length === 8) {
    if (checkOk(code)) return { ok: true, format: 'EAN-8', code };
    if ((code[0] === '0' || code[0] === '1') && checkOk(upcEToA(code))) return { ok: true, format: 'UPC-E', code };
    return { ok: false, reason: 'check_digit' };
  }
  return { ok: false, reason: 'length' };
}
