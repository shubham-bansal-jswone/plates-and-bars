import { RANGE_DAYS, addDays, type PrSet, type SeriesRange } from '@plate-and-bar/core';

/** The sets dated from `end` minus the range's days up to `end`, both days included ('all': up to `end`). For the e1RM charts and weekly volume, not for PRs. Input is oldest first and stays so. */
export function setsInRange(all: readonly PrSet[], end: string, range: SeriesRange): PrSet[] {
  const from = range === 'all' ? null : addDays(end, -RANGE_DAYS[range]);
  return all.filter((s) => s.date <= end && (from === null || s.date >= from));
}

/** The sets dated before `date` (that day not included), the history `priorBestOf` reads for the toast. */
export function setsBefore(all: readonly PrSet[], date: string): PrSet[] {
  return all.filter((s) => s.date < date);
}
