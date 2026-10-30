import { readFileSync } from 'fs';
import { resolve } from 'path';
import { barLayout, BAR_MAX_WIDTH, BAR_MIN_HEIGHT, WEIGHT_CHART_BOX as box, type BarRect } from '../src';

const g = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/bar-layout.json'), 'utf8')) as {
  box: typeof box;
  cases: { note: string; values: (number | null)[]; target: number | null; expected: { max: number; bars: (BarRect | null)[]; targetY: number | null } }[];
};

describe('barLayout golden vectors', () => {
  it('uses the prototype weight box', () => expect(g.box).toEqual(box));
  it.each(g.cases.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const l = barLayout(c.values, c.target ?? undefined, box)!;
    expect(l.max).toBeCloseTo(c.expected.max, 9);
    expect(l.bars).toHaveLength(c.expected.bars.length);
    c.expected.bars.forEach((e, i) => {
      const b = l.bars[i];
      if (e === null) return expect(b).toBeNull();
      expect(b).not.toBeNull();
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(b![k]).toBeCloseTo(e[k], 9);
    });
    if (c.expected.targetY === null) expect(l.targetY).toBeNull();
    else expect(l.targetY).toBeCloseTo(c.expected.targetY, 9);
  });
});

describe('barLayout rules', () => {
  it('has no layout with no values', () => expect(barLayout([], 5, box)).toBeNull());

  it('a target never changes x or width, only heights', () => {
    const v = [40, 80, null, 60];
    const a = barLayout(v, undefined, box)!, b = barLayout(v, 100, box)!;
    b.bars.forEach((r, i) => {
      const o = a.bars[i];
      if (!o || !r) return expect(o).toEqual(r);
      expect([r.x, r.width]).toEqual([o.x, o.width]);
      expect(r.height).toBeLessThan(o.height);
    });
  });

  it('a far target is drawn at the top and the axis grows to it', () => {
    const l = barLayout([10, 20], 1000, box)!;
    expect(l.max).toBe(1000);
    expect(l.targetY).toBeCloseTo(16, 9);
  });

  it('ignores a target that is 0, negative or not finite', () => {
    const base = barLayout([10, 20], undefined, box)!;
    for (const t of [0, -5, Infinity, NaN]) expect(barLayout([10, 20], t, box)).toEqual(base);
  });

  it('a real 0 is a stub, a null is nothing, and the constants hold', () => {
    const l = barLayout([0, null], undefined, box)!;
    expect(l.bars[0]!.height).toBe(BAR_MIN_HEIGHT);
    expect(l.bars[1]).toBeNull();
    expect(BAR_MAX_WIDTH).toBe(40);
  });
});
