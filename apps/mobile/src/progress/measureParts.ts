import { measureSeries, type MeasureKey, type TrendPoint } from '@plate-and-bar/core';

type Tapes = Parameters<typeof measureSeries>[0];

/** "Waist (at navel)" to "Waist": the part's name without its how-to note, for chips, headings and sentences. */
export const partName = (label: string): string => label.replace(/\s*\(.*\)\s*$/, '');

export interface PartChoice {
  /** Parts to offer as chips, in content order: every part with a reading. */
  chips: MeasureKey[];
  /** The part drawn: the user's choice while it has a reading, else waist while it has one, else the first part with a reading, else waist. */
  shown: MeasureKey;
  /** Every point of the shown part on or before `end`. */
  series: TrendPoint[];
}

/** Which tape parts to offer and which one to draw on `end`, from `measureSeries` over every reading. */
export function choosePart(tapes: Tapes, keys: readonly MeasureKey[], end: string, choice: MeasureKey | null): PartChoice {
  const all = new Map(keys.map((k) => [k, measureSeries(tapes, k, end, Infinity)] as const));
  const n = (k: MeasureKey): number => all.get(k)?.length ?? 0;
  const shown: MeasureKey =
    choice && n(choice) >= 1 ? choice : n('waist_cm') >= 1 ? 'waist_cm' : (keys.find((k) => n(k) >= 1) ?? 'waist_cm');
  return { chips: keys.filter((k) => n(k) >= 1), shown, series: all.get(shown) ?? [] };
}
