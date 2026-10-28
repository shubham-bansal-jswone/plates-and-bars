import type { ExType } from './progression';

/**
 * The weight unit the user sees and types (#1185). A device-local setting, never synced; kg is the default.
 * Storage, the contract and every calculation stay in kg (`weight_kg` fields unchanged); convert only at
 * the display and input edges. New, no prototype counterpart (the prototype is kg only).
 */
export type WeightUnit = 'kg' | 'lb';

/** The default unit. */
export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'kg';

/** Kilograms in one pound: the exact international definition. */
export const KG_PER_LB = 0.45359237;

/** Exact kg to lb, unrounded. */
export const kgToLb = (kg: number): number => kg / KG_PER_LB;

/** Exact lb to kg, unrounded. */
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

/** A stored kg value as a number in `unit`, unrounded (kg passes through unchanged). */
export const fromKg = (kg: number, unit: WeightUnit = 'kg'): number => (unit === 'lb' ? kgToLb(kg) : kg);

/** A value typed or shown in `unit` as kg (kg passes through unchanged). */
export const toKg = (value: number, unit: WeightUnit = 'kg'): number => (unit === 'lb' ? lbToKg(value) : value);

/** One decimal, like prototype `r1` (the display rounding of every weight). */
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The unit's short label: `kg` or `lb`. */
export const unitLabel = (unit: WeightUnit = 'kg'): string => unit;

/**
 * A stored kg weight as display text: rounded to one decimal in `unit`, no label. kg gives exactly what the
 * app showed before (`r1`); 100 kg is `220.5` in lb.
 */
export function formatWeight(kg: number, unit: WeightUnit = 'kg'): string {
  return String(r1(fromKg(kg, unit)));
}

/** One number with an optional single decimal part: no sign, exponent, thousands separator or other text. */
const WEIGHT_TEXT = /^\s*\d+(?:[.,]\d+)?\s*$/;
/** A comma then exactly three digits ("1,000") is a thousands separator in many locales: ambiguous, so refused. */
const THOUSANDS_COMMA = /^\s*\d+,\d{3}\s*$/;

/**
 * Reads a typed weight in `unit` and returns kg, or null unless the text is one plain non-negative number
 * with at most one decimal separator (`.` or `,`): empty, junk, trailing text (`12abc`), exponents (`1e3`),
 * a sign, thousands separators (`1,000`, `1.234,5`) and NaN or infinite numbers are all null. A number
 * (not text) must be finite and not negative. Zero is valid. The kg is exact, not rounded: 225 lb is
 * 102.05828325 kg and shows back as 225. There is no ceiling here: the caller validates the range against the contract bound for what it stores (body weight `weight_kg`, or a lifted load) before saving. In kg the typed number passes through unchanged. Stricter than
 * `num` on purpose; new, no prototype counterpart.
 */
export function parseWeightInput(text: unknown, unit: WeightUnit = 'kg'): number | null {
  let n: number;
  if (typeof text === 'number') n = text;
  else if (typeof text === 'string' && WEIGHT_TEXT.test(text) && !THOUSANDS_COMMA.test(text)) n = parseFloat(text.replace(',', '.'));
  else return null;
  return Number.isFinite(n) && n >= 0 ? toKg(n, unit) : null;
}

/** Smallest jump per equipment type in pounds for lb users: plates and stacks come in lb. */
export const LB_STEP: Readonly<Record<ExType, number>> = {
  barbell: 5, // 2.5 kg step (2.5 lb plates in pairs); the smallest pair a lb gym has
  dumbbell: 2.5, // 2.5 kg step; lb dumbbells come in 2.5 or 5 lb jumps, so take the finer one
  machine: 5, // 5 kg step; lb stacks move in 5 lb (sometimes 10)
  cable: 5, // as machine
  assisted: 5, // as machine
  other: 2.5, // 2.5 kg step; the fine default
  bodyweight: 0,
  time: 0,
};

/** The finest lb step a custom kg step maps to (a nonzero kg step never becomes 0). */
const LB_STEP_MIN = 2.5;

/**
 * The lb step for an exercise: the type's `LB_STEP` when `kgStep` is that type's default kg step (see
 * `DEFAULT_STEP`: 2.5 kg for barbell/dumbbell/other, 5 kg for machine/cable/assisted); a step the user
 * set themselves converts to lb and rounds to the nearest 2.5 lb, at least 2.5 lb. Step 0 stays 0.
 */
export function lbStepFor(type: ExType, kgStep: number, defaultKgStep: number): number {
  if (!(kgStep > 0)) return 0;
  if (kgStep === defaultKgStep) return LB_STEP[type];
  return Math.max(LB_STEP_MIN, Math.round(kgToLb(kgStep) / LB_STEP_MIN) * LB_STEP_MIN);
}
