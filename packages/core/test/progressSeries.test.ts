import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DOWNSAMPLE_THRESHOLD, RANGE_DAYS, WAIST_CHART_POINTS, downsampleWeekly, measureSeries, rangeSeries, waistSeries, weightSeries,
  type MeasureKey, type MeasurementFacts, type SeriesRange, type TrendPoint,
} from '../src/index';

type P = [string, number];
const tp = (rows: P[]): TrendPoint[] => rows.map(([date, v]) => ({ date, v }));
const g = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/progressSeries.json'), 'utf8')) as {
  downsample_threshold: number;
  range_days: Record<string, number>;
  range: { note: string; end: string; range: SeriesRange; points: P[]; expected: P[] }[];
  downsample: { note: string; points: P[]; last: P[]; max: P[] }[];
  measure: { tapes: MeasurementFacts[]; date: string; expected: Record<MeasureKey, P[]> };
  measure_long: { tapes: MeasurementFacts[]; date: string; expected: Partial<Record<MeasureKey, P[]>> };
};

const day = (i: number) => new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
// Inputs for the pins below; PIN_WAIST and PIN_WEIGHT are the output of waistSeries and weightSeries on the base branch (c26ba6c4).
const PIN_TAPES: MeasurementFacts[] = Array.from({ length: 26 }, (_, i) => ({ date: day(25 - i), waist_cm: i % 7 === 3 ? 0 : 80 + (i % 5) / 2, deleted_at: i === 9 ? 'x' : null }));
const PIN_WEIGHTS = Array.from({ length: 34 }, (_, i) => ({ date: day(i), weight_kg: 70 + (i % 6) / 10, deleted_at: i === 4 ? 'x' : null }));
const PIN_WAIST = '[{"date":"2026-08-01","v":80},{"date":"2026-08-03","v":81.5},{"date":"2026-08-04","v":81},{"date":"2026-08-05","v":80.5},{"date":"2026-08-06","v":80},{"date":"2026-08-07","v":82},{"date":"2026-08-08","v":81.5},{"date":"2026-08-10","v":80.5},{"date":"2026-08-11","v":80},{"date":"2026-08-12","v":82},{"date":"2026-08-13","v":81.5},{"date":"2026-08-14","v":81},{"date":"2026-08-15","v":80.5},{"date":"2026-08-18","v":81.5},{"date":"2026-08-19","v":81},{"date":"2026-08-20","v":80.5},{"date":"2026-08-21","v":80},{"date":"2026-08-22","v":82},{"date":"2026-08-24","v":81},{"date":"2026-08-25","v":80.5}]';
const PIN_WEIGHT = '[{"date":"2026-08-04","v":70.3},{"date":"2026-08-06","v":70.5},{"date":"2026-08-07","v":70},{"date":"2026-08-08","v":70.1},{"date":"2026-08-09","v":70.2},{"date":"2026-08-10","v":70.3},{"date":"2026-08-11","v":70.4},{"date":"2026-08-12","v":70.5},{"date":"2026-08-13","v":70},{"date":"2026-08-14","v":70.1},{"date":"2026-08-15","v":70.2},{"date":"2026-08-16","v":70.3},{"date":"2026-08-17","v":70.4},{"date":"2026-08-18","v":70.5},{"date":"2026-08-19","v":70},{"date":"2026-08-20","v":70.1},{"date":"2026-08-21","v":70.2},{"date":"2026-08-22","v":70.3},{"date":"2026-08-23","v":70.4},{"date":"2026-08-24","v":70.5},{"date":"2026-08-25","v":70},{"date":"2026-08-26","v":70.1},{"date":"2026-08-27","v":70.2},{"date":"2026-08-28","v":70.3},{"date":"2026-08-29","v":70.4},{"date":"2026-08-30","v":70.5},{"date":"2026-08-31","v":70},{"date":"2026-09-01","v":70.1},{"date":"2026-09-02","v":70.2},{"date":"2026-09-03","v":70.3}]';

describe('progress series (#1351 C1)', () => {
  it('constants match the vectors', () => {
    expect(DOWNSAMPLE_THRESHOLD).toBe(g.downsample_threshold);
    expect(RANGE_DAYS).toEqual(g.range_days);
  });

  it.each(g.range.map((c) => [c.note, c] as const))('rangeSeries: %s', (_n, c) => {
    expect(rangeSeries(tp(c.points), c.end, c.range)).toEqual(tp(c.expected));
  });
  it('a short series comes back as a copy', () => {
    const pts = tp([['2026-10-01', 1]]);
    const out = downsampleWeekly(pts, 'last');
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });
  it('rangeSeries does not modify or alias its input', () => {
    const pts = tp([['2026-10-01', 1]]);
    const out = rangeSeries(pts, '2026-10-29', 'all');
    expect(out).not.toBe(pts);
    expect(pts).toEqual(tp([['2026-10-01', 1]]));
  });

  describe.each(g.downsample.map((c) => [c.note, c] as const))('downsampleWeekly: %s', (_n, c) => {
    it('last', () => expect(downsampleWeekly(tp(c.points), 'last')).toEqual(tp(c.last)));
    it('max', () => expect(downsampleWeekly(tp(c.points), 'max')).toEqual(tp(c.max)));
  });
  it('threshold is exclusive and unsorted input is handled', () => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), v: i }));
    expect(downsampleWeekly(days(DOWNSAMPLE_THRESHOLD), 'last')).toHaveLength(DOWNSAMPLE_THRESHOLD);
    const over = days(DOWNSAMPLE_THRESHOLD + 1);
    expect(downsampleWeekly([...over].reverse(), 'last')).toEqual(downsampleWeekly(over, 'last'));
    expect(downsampleWeekly(over, 'last').length).toBeLessThan(30);
  });
  it('max keeps the earliest point on a tie', () => {
    const pts = Array.from({ length: 125 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10), v: 5 }));
    expect(downsampleWeekly(pts, 'max')[0]).toEqual({ date: '2026-01-05', v: 5 });
  });

  describe('weightSeries limit', () => {
    it('default output is pinned to the pre-change literal (30 points)', () => {
      expect(JSON.stringify(weightSeries(PIN_WEIGHTS, day(33)))).toBe(PIN_WEIGHT);
      expect(weightSeries(PIN_WEIGHTS, day(33), 30)).toEqual(weightSeries(PIN_WEIGHTS, day(33)));
    });
    it('Infinity keeps all, small limits keep the latest, 0, -1 and NaN give none', () => {
      const all = weightSeries(PIN_WEIGHTS, day(33), Infinity);
      expect(all).toHaveLength(33);
      expect(weightSeries(PIN_WEIGHTS, day(33), 2)).toEqual(all.slice(-2));
      for (const n of [0, -1, NaN]) expect(weightSeries(PIN_WEIGHTS, day(33), n)).toEqual([]);
    });
  });

  describe('measureSeries', () => {
    const keys = Object.keys(g.measure.expected) as MeasureKey[];
    it.each(keys)('golden: %s', (k) => {
      expect(measureSeries(g.measure.tapes, k, g.measure.date)).toEqual(tp(g.measure.expected[k]));
    });
    it.each(Object.keys(g.measure_long.expected) as MeasureKey[])('golden over 20 rows: %s', (k) => {
      expect(measureSeries(g.measure_long.tapes, k, g.measure_long.date)).toEqual(tp(g.measure_long.expected[k] as P[]));
    });
    it('waistSeries output is pinned to the pre-change literal', () => {
      expect(JSON.stringify(waistSeries(PIN_TAPES, day(24)))).toBe(PIN_WAIST);
      expect(JSON.stringify(measureSeries(PIN_TAPES, 'waist_cm', day(24)))).toBe(PIN_WAIST);
    });
    it('limit 0, negative and NaN give none', () => {
      for (const n of [0, -1, NaN]) expect(measureSeries(g.measure.tapes, 'waist_cm', g.measure.date, n)).toEqual([]);
    });
    it('limit Infinity returns every point', () => {
      const tapes = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, arm_cm: 30 }));
      expect(measureSeries(tapes, 'arm_cm', '2026-09-30', Infinity)).toHaveLength(30);
      expect(measureSeries(tapes, 'arm_cm', '2026-09-30')).toHaveLength(WAIST_CHART_POINTS);
    });
  });
});
