import { KCAL_PER_KG, KCAL_PER_LB, KG_PER_LB } from '../src';

describe('KCAL_PER_LB', () => {
  it('is 3,500 kcal per lb', () => {
    expect(KCAL_PER_LB).toBe(3500);
  });
  it('is the kg constant converted to lb and rounded to the nearest 100', () => {
    expect(Math.round((KCAL_PER_KG * KG_PER_LB) / 100) * 100).toBe(KCAL_PER_LB);
  });
});
