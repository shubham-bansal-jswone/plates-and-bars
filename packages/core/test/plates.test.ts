import { platesFor, nearestLoadable, loadableNeighbours, describePlates, lbToKg } from '../src';

const lb = { unit: 'lb' } as const;

describe('platesFor (#1176)', () => {
  it('100 kg is 25 + 15 per side', () => {
    const r = platesFor(100)!;
    expect(r.perSide).toEqual([{ plate: 25, count: 1 }, { plate: 15, count: 1 }]);
    expect(r).toMatchObject({ loadedTotal: 100, remainder: 0, unit: 'kg', belowBar: false });
  });

  it('225 lb is 45 + 45 per side, exact from the kg value', () => {
    const r = platesFor(lbToKg(225), lb)!;
    expect(r.perSide).toEqual([{ plate: 45, count: 2 }]);
    expect(r).toMatchObject({ loadedTotal: 225, remainder: 0, unit: 'lb' });
    expect(r.loadedKg).toBeCloseTo(lbToKg(225), 9);
  });

  it('lb fractional plates stay exact: 135 + 5 lb', () => {
    const r = platesFor(lbToKg(140), lb)!;
    expect(r.perSide).toEqual([{ plate: 45, count: 1 }, { plate: 2.5, count: 1 }]);
    expect(r.loadedTotal).toBe(140);
  });

  it('bar only, at the bar weight', () => {
    expect(platesFor(20)).toMatchObject({ perSide: [], loadedTotal: 20, remainder: 0, belowBar: false });
    expect(platesFor(lbToKg(45), lb)).toMatchObject({ perSide: [], loadedTotal: 45, remainder: 0 });
  });

  it('below the bar returns the bar alone and a negative remainder', () => {
    expect(platesFor(15)).toMatchObject({ perSide: [], loadedTotal: 20, remainder: -5, belowBar: true });
    expect(platesFor(0)!.belowBar).toBe(true);
  });

  it('unreachable target loads at or below and reports the remainder', () => {
    const r = platesFor(101)!; // side 40.5; smallest plate 1.25 -> 40 (25+15)
    expect(r.loadedTotal).toBe(100);
    expect(r.remainder).toBe(1);
    expect(platesFor(102.4)!.loadedTotal).toBe(102.5 - 2.5 > 0 ? 100 : 0);
    expect(platesFor(102.5)!.loadedTotal).toBe(102.5);
  });

  it('round up and nearest', () => {
    expect(platesFor(101, { round: 'up' })).toMatchObject({ loadedTotal: 102.5, remainder: -1.5 });
    expect(platesFor(101, { round: 'nearest' })!.loadedTotal).toBe(100);
    expect(platesFor(102, { round: 'nearest' })!.loadedTotal).toBe(102.5);
    expect(platesFor(101.25, { round: 'nearest' })!.loadedTotal).toBe(100); // tie goes down
    expect(platesFor(100, { round: 'up' })!.loadedTotal).toBe(100);
    expect(platesFor(10, { round: 'up' })!.loadedTotal).toBe(20);
  });

  it('is exact where greedy fails: plates 30 and 20 for a 40 side', () => {
    const r = platesFor(100, { bar: 20, plates: [30, 20] })!; // side 40 = 20 + 20, greedy takes 30 and misses
    expect(r.perSide).toEqual([{ plate: 20, count: 2 }]);
    expect(r.remainder).toBe(0);
  });

  it('prefers fewest plates', () => {
    expect(platesFor(120)!.perSide).toEqual([{ plate: 25, count: 2 }]);
    expect(platesFor(220)!.perSide).toEqual([{ plate: 25, count: 4 }]);
  });

  it('custom plate sets, order and duplicates ignored', () => {
    const r = platesFor(60, { plates: [5, 20, 5, 10] })!;
    expect(r.perSide).toEqual([{ plate: 20, count: 1 }]);
    const only5 = platesFor(60, { plates: [5] })!; // side 20 = 4 x 5
    expect(only5.perSide).toEqual([{ plate: 5, count: 4 }]);
    expect(platesFor(33, { plates: [10] })).toMatchObject({ loadedTotal: 20, remainder: 13 });
  });

  it('custom bar, in the chosen unit', () => {
    expect(platesFor(35, { bar: 15 })).toMatchObject({ perSide: [{ plate: 10, count: 1 }], loadedTotal: 35 });
    expect(platesFor(lbToKg(65), { unit: 'lb', bar: 35 })!.perSide).toEqual([{ plate: 10, count: 1 }, { plate: 5, count: 1 }]);
    expect(platesFor(20, { bar: 0 })!.perSide).toEqual([{ plate: 10, count: 1 }]);
  });

  it('collars count toward the load, one per side', () => {
    const r = platesFor(105, { collar: 2.5 })!; // fixed 25, side 40
    expect(r.perSide).toEqual([{ plate: 25, count: 1 }, { plate: 15, count: 1 }]);
    expect(r.loadedTotal).toBe(105);
    expect(platesFor(24, { collar: 2.5 })).toMatchObject({ belowBar: true, loadedTotal: 25 });
  });

  it('invalid input is null', () => {
    expect(platesFor(NaN)).toBeNull();
    expect(platesFor(-1)).toBeNull();
    expect(platesFor(Infinity)).toBeNull();
    expect(platesFor(100, { bar: -20 })).toBeNull();
    expect(platesFor(100, { collar: NaN })).toBeNull();
    expect(platesFor(100, { plates: [] })).toBeNull();
    expect(platesFor(100, { plates: [0] })).toBeNull();
    expect(platesFor(100, { plates: [-5, 10] })).toBeNull();
    expect(platesFor(100, { plates: [NaN] })).toBeNull();
    expect(platesFor('100' as unknown as number)).toBeNull();
    expect(platesFor(100, { round: 'sideways' as unknown as 'up' })).toBeNull();
    expect(platesFor(10_000)).toBeNull();
  });

  it('too fine a plate grid for a huge side is null, not a hang', () => {
    expect(platesFor(3999, { plates: [0.001, 7] })).toBeNull();
  });
});

describe('nearestLoadable, loadableNeighbours, describePlates', () => {
  it('returns kg, nearest, bar floor', () => {
    expect(nearestLoadable(102)).toBe(102.5);
    expect(nearestLoadable(101)).toBe(100);
    expect(nearestLoadable(5)).toBe(20);
    expect(nearestLoadable(lbToKg(227), lb)).toBeCloseTo(lbToKg(225), 9);
    expect(nearestLoadable(NaN)).toBeNull();
  });

  it('neighbours bracket the target', () => {
    const n = loadableNeighbours(101)!;
    expect([n.below.loadedTotal, n.above.loadedTotal]).toEqual([100, 102.5]);
    const e = loadableNeighbours(100)!;
    expect(e.below.loadedTotal).toBe(e.above.loadedTotal);
    expect(loadableNeighbours(-1)).toBeNull();
  });

  it('screen reader line', () => {
    expect(describePlates(platesFor(52.5)!)).toBe('Per side: 15, 1.25');
    expect(describePlates(platesFor(120)!)).toBe('Per side: 2 x 25');
    expect(describePlates(platesFor(20)!)).toBe('Bar only');
  });
});
