import { readFileSync } from 'fs';
import { resolve } from 'path';
import { chartLayout, downsampleWeekly, WEIGHT_CHART_BOX as box, type ChartLayout, type TrendPoint } from '../src';
import { addDays, daysBetween } from '../src/dates';

const g = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/chart-layout.json'), 'utf8')) as {
  box: typeof box;
  cases: { note: string; values: number[]; dates: string[]; expected: ChartLayout }[];
};

describe('chartLayout golden vectors (x by date, #1370)', () => {
  it('uses the prototype weight box', () => expect(g.box).toEqual(box));
  it.each(g.cases.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const l = chartLayout(c.values, box, c.dates)!;
    expect(l.min).toBeCloseTo(c.expected.min, 9);
    expect(l.max).toBeCloseTo(c.expected.max, 9);
    expect(l.points).toHaveLength(c.expected.points.length);
    c.expected.points.forEach((e, i) => {
      expect(l.points[i]?.x).toBeCloseTo(e.x, 9);
      expect(l.points[i]?.y).toBeCloseTo(e.y, 9);
    });
  });
});

describe('chartLayout spacing rules', () => {
  const vals = [80, 78, 77], dates = ['2026-10-01', '2026-10-04', '2026-10-11'];
  it('keeps index spacing without dates (the prototype layout)', () => {
    expect(chartLayout(vals, box)!.points.map((p) => p.x)).toEqual([34, 173, 312]);
  });
  it('falls back to index spacing when dates do not match the values', () => {
    expect(chartLayout(vals, box, dates.slice(0, 2))!.points.map((p) => p.x)).toEqual([34, 173, 312]);
  });
  it('falls back to index spacing when the dates run backwards', () => {
    expect(chartLayout(vals, box, [...dates].reverse())!.points.map((p) => p.x)).toEqual([34, 173, 312]);
  });
  it.each([
    ['a middle date out of order', ['2026-10-01', '2026-10-15', '2026-10-10']],
    ['a middle date before the first', ['2026-10-10', '2026-09-01', '2026-10-20']],
    ['a malformed middle date', ['2026-10-01', 'not-a-date', '2026-10-11']],
  ])('falls back to index spacing for %s, all x inside the box', (_n, ds) => {
    const xs = chartLayout(vals, box, ds)!.points.map((p) => p.x);
    expect(xs).toEqual([34, 173, 312]);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(34), expect(x).toBeLessThanOrEqual(312);
  });
  it('still needs 2 points', () => {
    expect(chartLayout([80], box, ['2026-10-01'])).toBeNull();
    expect(chartLayout([], box, [])).toBeNull();
  });
  it('dates change only x, never y or the axis', () => {
    const a = chartLayout(vals, box)!, b = chartLayout(vals, box, dates)!;
    expect([b.min, b.max]).toEqual([a.min, a.max]);
    expect(b.points.map((p) => p.y)).toEqual(a.points.map((p) => p.y));
    expect(b.points[1]?.x).not.toBe(a.points[1]?.x);
  });
  it('a point twice as far in days is twice as far along x', () => {
    const l = chartLayout([1, 2, 3], box, ['2026-10-01', '2026-10-02', '2026-10-04'])!;
    const [a, b, c] = l.points.map((p) => p.x) as [number, number, number];
    expect((c - a) / (b - a)).toBeCloseTo(3, 9);
  });
  it('a downsampled series keeps each kept point on its own date, so x follows the kept dates', () => {
    const many: TrendPoint[] = Array.from({ length: 200 }, (_, k) => ({ date: addDays('2026-06-03', k), v: 80 - k / 10 }));
    const kept = downsampleWeekly(many, 'last');
    expect(kept.length).toBeLessThan(many.length);
    for (const p of kept) expect(many).toContainEqual(p);
    const l = chartLayout(kept.map((p) => p.v), box, kept.map((p) => p.date))!;
    const first = kept[0]!.date, span = daysBetween(first, kept[kept.length - 1]!.date);
    kept.forEach((p, i) => expect(l.points[i]!.x).toBeCloseTo(34 + (278 * daysBetween(first, p.date)) / span, 9));
    // The last week is short (ends on a Saturday), so its gap is 6 days, not the 7 an index step would draw.
    const n = kept.length, step = (l.points[n - 2]!.x - l.points[n - 3]!.x);
    expect(l.points[n - 1]!.x - l.points[n - 2]!.x).toBeCloseTo((step * 6) / 7, 9);
  });
});
