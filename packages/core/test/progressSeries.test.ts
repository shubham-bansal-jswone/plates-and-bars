import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DOWNSAMPLE_THRESHOLD, RANGE_DAYS, WAIST_CHART_POINTS, downsampleWeekly, measureSeries, rangeSeries, waistSeries,
  type MeasureKey, type MeasurementFacts, type SeriesRange, type TrendPoint,
} from '../src/index';

type P = [string, number];
const tp = (rows: P[]): TrendPoint[] => rows.map(([date, v]) => ({ date, v }));
const g = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/progressSeries.json'), 'utf8')) as {
  downsample_threshold: number;
  range_days: Record<string, number>;
  range: { note: string; today: string; range: SeriesRange; points: P[]; expected: P[] }[];
  downsample: { note: string; points: P[]; last: P[]; max: P[] }[];
  measure: { tapes: MeasurementFacts[]; date: string; expected: Record<MeasureKey, P[]> };
};

describe('progress series (#1351 C1)', () => {
  it('constants match the vectors', () => {
    expect(DOWNSAMPLE_THRESHOLD).toBe(g.downsample_threshold);
    expect(RANGE_DAYS).toEqual(g.range_days);
  });

  it.each(g.range.map((c) => [c.note, c] as const))('rangeSeries: %s', (_n, c) => {
    expect(rangeSeries(tp(c.points), c.today, c.range)).toEqual(tp(c.expected));
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

  describe('measureSeries', () => {
    const keys = Object.keys(g.measure.expected) as MeasureKey[];
    it.each(keys)('golden: %s', (k) => {
      expect(measureSeries(g.measure.tapes, k, g.measure.date)).toEqual(tp(g.measure.expected[k]));
    });
    it('waistSeries is byte-identical to measureSeries waist, with the 20-point cap', () => {
      const tapes: MeasurementFacts[] = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`, waist_cm: 80 + i / 10, deleted_at: i === 5 ? 'x' : null,
      }));
      for (const upTo of ['2026-09-30', '2026-09-15', '2026-08-01']) {
        const w = waistSeries(tapes, upTo);
        expect(JSON.stringify(measureSeries(tapes, 'waist_cm', upTo))).toBe(JSON.stringify(w));
        expect(w.length).toBeLessThanOrEqual(WAIST_CHART_POINTS);
      }
      expect(waistSeries(tapes, '2026-09-30')).toHaveLength(20);
      expect(waistSeries(g.measure.tapes, g.measure.date)).toEqual(tp(g.measure.expected.waist_cm));
    });
    it('limit Infinity returns every point', () => {
      const tapes = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, arm_cm: 30 }));
      expect(measureSeries(tapes, 'arm_cm', '2026-09-30', Infinity)).toHaveLength(30);
      expect(measureSeries(tapes, 'arm_cm', '2026-09-30')).toHaveLength(20);
    });
  });
});
