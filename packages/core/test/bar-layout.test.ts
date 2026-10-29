import { barLayout, BAR_MAX_WIDTH, BAR_TARGET_MAX_RATIO, WEIGHT_CHART_BOX as box } from '../src';

// W 320, H 150, px 34, py 16: plot height 118, baseline y 134, top y 16, x from 34 to 312.
describe('barLayout', () => {
  it('lays out bars from the baseline, x and width by slot', () => {
    const l = barLayout([50, 100, 25, 100, 75, 0, 100, 100, 100, 100, 100, 100], undefined, box)!;
    const slot = 278 / 12;
    expect(l.max).toBe(100);
    expect(l.targetY).toBeNull();
    const b = l.bars[0]!;
    expect(b.width).toBeCloseTo(slot * 0.7, 6);
    expect(b.x).toBeCloseTo(34 + (slot - b.width) / 2, 6);
    expect(b.height).toBeCloseTo(59, 6);
    expect(b.y + b.height).toBeCloseTo(134, 6);
    expect(l.bars[1]!.height).toBeCloseTo(118, 6);
    expect(l.bars[1]!.x).toBeCloseTo(34 + slot + (slot - b.width) / 2, 6);
  });

  it('caps the width of a bar', () => {
    expect(barLayout([5, 6], undefined, box)!.bars[0]!.width).toBe(BAR_MAX_WIDTH);
  });

  it('leaves a gap for null, never a zero-height bar', () => {
    const l = barLayout([10, null, 20], undefined, box)!;
    expect(l.bars[1]).toBeNull();
    expect(l.bars[0]).not.toBeNull();
    expect(l.bars[2]!.height).toBeCloseTo(118, 6);
  });

  it('a real 0 is a zero-height bar, and all gaps or zeros keep a sane axis', () => {
    expect(barLayout([0, 10], undefined, box)!.bars[0]!.height).toBe(0);
    const none = barLayout([null, null], undefined, box)!;
    expect(none.max).toBe(1);
    expect(none.bars).toEqual([null, null]);
    expect(barLayout([], 5, box)).toBeNull();
  });

  it('a target stretches the axis and moves heights, never x or width', () => {
    const v = [40, 80, null, 60];
    const without = barLayout(v, undefined, box)!;
    const withT = barLayout(v, 100, box)!;
    expect(withT.max).toBe(100);
    expect(withT.targetY).toBeCloseTo(16, 6);
    withT.bars.forEach((b, i) => {
      const a = without.bars[i];
      if (!a || !b) return expect(a).toEqual(b);
      expect([b.x, b.width]).toEqual([a.x, a.width]);
      expect(b.height).toBeLessThan(a.height);
    });
    // A target inside the range changes nothing.
    const inside = barLayout(v, 50, box)!;
    expect(inside.max).toBe(80);
    expect(inside.targetY).toBeCloseTo(134 - (50 / 80) * 118, 6);
    expect(inside.bars).toEqual(without.bars);
  });

  it('does not draw an off-range target, and leaves the bars alone', () => {
    const base = barLayout([10, 20], undefined, box)!;
    const far = barLayout([10, 20], 20 * BAR_TARGET_MAX_RATIO + 1, box)!;
    expect(far.targetY).toBeNull();
    expect(far.bars).toEqual(base.bars);
    expect(barLayout([10, 20], 40, box)!.targetY).not.toBeNull();
    expect(barLayout([10, 20], 0, box)!.targetY).toBeNull();
    expect(barLayout([10, 20], -5, box)!.targetY).toBeNull();
  });
});
