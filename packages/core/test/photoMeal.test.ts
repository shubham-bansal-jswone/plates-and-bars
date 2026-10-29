import { capPhotoItems, clampPhotoServings, photoAdjLabel, photoEstimateLog, photoLogQty, photoMacros, stepPhotoAdj, PHOTO_ITEMS_MAX } from '../src/index';

// Golden numbers worked from the prototype-final tag: `analysePhoto`, `phMacros`, `ph-add`, the portion slider.
describe('capPhotoItems (raw.slice(0, 12))', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => i);
  it('keeps 12 of 15, in order', () => expect(capPhotoItems(list(15))).toEqual(list(12)));
  it('keeps all of 12 and of 3', () => {
    expect(capPhotoItems(list(12))).toHaveLength(12);
    expect(capPhotoItems(list(3))).toEqual([0, 1, 2]);
  });
  it('exports the cap', () => expect(PHOTO_ITEMS_MAX).toBe(12));
});

describe('clampPhotoServings (`analysePhoto`)', () => {
  it.each([
    [1.5, 1.5], [0.1, 0.25], [0.25, 0.25], [6, 6], [9, 6], [-2, 0.25], [100, 6],
    [0, 1], ['', 1], [null, 1], [undefined, 1], ['abc', 1], [NaN, 1], ['2,5', 2.5], ['3', 3],
  ])('%p -> %p', (v, out) => expect(clampPhotoServings(v)).toBe(out));
});

describe('stepPhotoAdj (slider 0.5 to 2 step 0.25)', () => {
  it('steps by 0.25', () => {
    expect(stepPhotoAdj(1, 1)).toBe(1.25);
    expect(stepPhotoAdj(1, -1)).toBe(0.75);
  });
  it('stops at the ends', () => {
    expect(stepPhotoAdj(2, 1)).toBe(2);
    expect(stepPhotoAdj(0.5, -1)).toBe(0.5);
  });
});

describe('photoMacros (phMacros)', () => {
  const base = { kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 };
  it('is base times mult times adj, unrounded', () => {
    const m = photoMacros(base, 1.5, 0.75);
    expect(m.kcal).toBeCloseTo(146.25, 10);
    expect(m.protein_g).toBeCloseTo(3.0375, 10);
    expect(m.carbs_g).toBeCloseTo(31.5, 10);
    expect(m.fat_g).toBeCloseTo(0.3375, 10);
  });
  it('is the base at 1 and 1', () => expect(photoMacros(base, 1, 1)).toEqual(base));
});

describe('ph-add amounts (lines 2235, 2236, 2239)', () => {
  it('photoLogQty is r1(mult * adj)', () => {
    expect(photoLogQty(1.5, 0.75)).toBe(1.1); // 1.125 -> 1.1
    expect(photoLogQty(2, 1.25)).toBe(2.5);
    expect(photoLogQty(0.25, 0.5)).toBe(0.1); // 0.125 -> 0.1
    expect(photoLogQty(6, 2)).toBe(12);
  });
  it('photoEstimateLog rounds kcal whole and the rest to 1 decimal', () => {
    expect(photoEstimateLog({ kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 }, 1, 1.25)).toEqual({ kcal: 163, protein_g: 3.4, carbs_g: 35, fat_g: 0.4 });
    expect(photoEstimateLog({ kcal: 99.5, protein_g: 0.04, carbs_g: 0, fat_g: 0 }, 1, 1)).toEqual({ kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
  it('photoAdjLabel is r1(adj)', () => {
    expect(photoAdjLabel(1.25)).toBe(1.3);
    expect(photoAdjLabel(0.75)).toBe(0.8);
    expect(photoAdjLabel(2)).toBe(2);
  });
});
