import { fromKg, toKg, type WeightUnit } from './weightUnit';

/**
 * Plate calculator (#1176): which plates go on each side of a barbell for a target weight. New rule, no
 * prototype counterpart (an app addition). Pure; the target arrives in kg (storage stays kg) and the answer
 * comes back in the chosen unit, so lb plates are exact. Barbell only.
 */

/** Default bar: 20 kg, or 45 lb. */
export const DEFAULT_BAR: Readonly<Record<WeightUnit, number>> = { kg: 20, lb: 45 };

/** Default plate denominations per side, largest first, in the unit's own numbers. */
export const DEFAULT_PLATES: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Options, all weights in `unit` (not kg). */
export interface PlateOptions {
  /** Unit plates, bar and results use. Default kg. */
  unit?: WeightUnit;
  /** Bar weight in `unit`. Default 20 kg / 45 lb. 0 is allowed (a bar-less machine). */
  bar?: number;
  /** Plate denominations available (any order, duplicates ignored); unlimited quantity of each. Default per unit. */
  plates?: readonly number[];
  /** Weight of one collar in `unit`; two are fitted, one per side. Default 0 (no collars). */
  collar?: number;
  /** Which way to resolve an unreachable target: `down` (default, never above), `up` (never below) or `nearest` (ties go down). */
  round?: 'down' | 'up' | 'nearest';
}

/** One plate size and how many go on each side. */
export interface PlateCount {
  plate: number;
  count: number;
}

export interface PlateLoad {
  /** Plates for one side, largest first, in `unit`. */
  perSide: PlateCount[];
  /** Total on the bar in `unit`: bar + collars + both sides. */
  loadedTotal: number;
  /** Target minus loaded, in `unit`. 0 when exact, positive when under, negative when over (`round: up`/`nearest`, or below the bar). */
  remainder: number;
  /** `loadedTotal` in kg. */
  loadedKg: number;
  unit: WeightUnit;
  /** True when the target is lighter than the empty bar (plus collars); the bar alone is returned. */
  belowBar: boolean;
}

/** Fixed-point scale: weights are worked as integer thousandths so 1.25 and lb plates never drift. */
const SCALE = 1000;
/** Largest per-side load searched, in thousandths (2000 kg or lb a side is beyond any bar). */
const MAX_SIDE = 2000 * SCALE;
const MAX_CELLS = 1_000_000;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const milli = (n: number): number => Math.round(n * SCALE);

/**
 * Solves "largest/smallest loadable per-side weight" exactly with a minimum-plate-count table, so it is right
 * for any plate set, not only canonical ones where greedy works. Returns plates in thousandths or null.
 */
function solveSide(side: number, plates: number[], round: 'down' | 'up' | 'nearest'): { total: number; counts: number[] } | null {
  const g = plates.reduce(gcd, 0);
  const cells = Math.floor(side / g);
  const upCells = Math.ceil(side / g);
  const reach = upCells + Math.ceil(plates[plates.length - 1]! / g) + 1; // smallest loadable >= side is within one plate of it
  if (reach > MAX_CELLS) return null;
  const w = plates.map((p) => p / g);
  const best = new Array<number>(reach + 1).fill(Infinity);
  const from = new Array<number>(reach + 1).fill(-1);
  best[0] = 0;
  for (let i = 1; i <= reach; i++) {
    for (let k = 0; k < w.length; k++) {
      const prev = i - w[k]!;
      if (prev >= 0 && best[prev]! + 1 < best[i]!) {
        best[i] = best[prev]! + 1;
        from[i] = k; // plates are sorted largest first, so ties keep the larger plate
      }
    }
  }
  let down = Math.min(cells, reach);
  while (down > 0 && best[down] === Infinity) down--;
  let up = upCells;
  while (up <= reach && best[up] === Infinity) up++;
  const hasUp = up <= reach;
  let pick = down;
  if (round === 'up') pick = hasUp ? up : down;
  else if (round === 'nearest' && hasUp && up * g - side < side - down * g) pick = up;
  const counts = new Array<number>(plates.length).fill(0);
  for (let i = pick; i > 0; i -= w[from[i]!]!) counts[from[i]!]!++;
  return { total: pick * g, counts };
}

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * The plates for one side of a barbell, or null for invalid input (non-finite or negative target, bar or
 * collar; no usable plates; a plate that is not positive and finite; a target beyond 2000 per side).
 * `targetKg` is the total bar weight in kg. By default an unreachable target loads the nearest weight at or
 * below it and reports the `remainder`; it never goes above unless `round` says so.
 */
export function platesFor(targetKg: number, opts: PlateOptions = {}): PlateLoad | null {
  const unit = opts.unit ?? 'kg';
  const bar = opts.bar ?? DEFAULT_BAR[unit];
  const collar = opts.collar ?? 0;
  const round = opts.round ?? 'down';
  const list = opts.plates ?? DEFAULT_PLATES[unit];
  if (!valid(targetKg) || !valid(bar) || !valid(collar)) return null;
  if (round !== 'down' && round !== 'up' && round !== 'nearest') return null;
  if (!list.every((p) => typeof p === 'number' && Number.isFinite(p) && milli(p) > 0)) return null;
  const plates = [...new Set(list.map(milli))].sort((a, b) => b - a);
  if (plates.length === 0) return null;

  const target = milli(fromKg(targetKg, unit));
  const fixed = milli(bar) + 2 * milli(collar);
  const make = (counts: number[], side: number): PlateLoad => {
    const total = fixed + 2 * side;
    return {
      perSide: counts.flatMap((count, i) => (count > 0 ? [{ plate: plates[i]! / SCALE, count }] : [])),
      loadedTotal: total / SCALE,
      remainder: (target - total) / SCALE,
      loadedKg: toKg(total / SCALE, unit),
      unit,
      belowBar: target < fixed,
    };
  };
  if (target < fixed) return make(plates.map(() => 0), 0);
  const side = (target - fixed) / 2;
  if (side > MAX_SIDE) return null;
  const sol = solveSide(side, plates, round);
  if (!sol) return null;
  return make(sol.counts, sol.total);
}

/**
 * The nearest loadable total for `targetKg`, in kg (ties go down; the bar alone when lighter than the bar), or
 * null for invalid input. For rounding warm-up steps to what the bar can hold (#1241); same options as `platesFor`.
 */
export function nearestLoadable(targetKg: number, opts: PlateOptions = {}): number | null {
  return platesFor(targetKg, { ...opts, round: 'nearest' })?.loadedKg ?? null;
}

/** The loadable weights just below and just above the target (equal when exact), or null for invalid input. */
export function loadableNeighbours(targetKg: number, opts: PlateOptions = {}): { below: PlateLoad; above: PlateLoad } | null {
  const below = platesFor(targetKg, { ...opts, round: 'down' });
  const above = platesFor(targetKg, { ...opts, round: 'up' });
  return below && above ? { below, above } : null;
}

/** Plain-text line for screen readers, e.g. "Per side: 20, 10, 2.5" (a plate repeated shows `2 x 20`). */
export function describePlates(load: PlateLoad): string {
  if (load.perSide.length === 0) return 'Bar only';
  return `Per side: ${load.perSide.map((p) => (p.count > 1 ? `${p.count} x ${p.plate}` : String(p.plate))).join(', ')}`;
}
