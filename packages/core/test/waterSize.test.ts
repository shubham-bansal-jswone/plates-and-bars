import { DEFAULT_WATER_SIZES, WATER_SIZE_MAX_ML, WATER_SIZE_MIN_ML, waterSizeEntry } from '../src';
import { prototypeSource, sliceLine } from './helpers';

// The prototype's own `data-wt` line, run on a settings object.
const src = prototypeSource();
const num = (v: unknown) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const line = sliceLine(src, '  if(t.dataset.wt)');
const run = new Function('S', 't', 'num', 'saveSoon', line) as (S: unknown, t: unknown, num: unknown, saveSoon: () => void) => void;
/** What the prototype stores for `text`: the new size, or null when it kept the old one. */
function proto(text: string): number | null {
  const S = { settings: { water: { glass: -1, bottle: 1000 } } };
  run(S, { dataset: { wt: 'glass' }, value: text }, num, () => {});
  return S.settings.water.glass === -1 ? null : S.settings.water.glass;
}

describe('waterSizeEntry (prototype data-wt)', () => {
  it('has the prototype bounds and keeps the defaults inside them', () => {
    expect([WATER_SIZE_MIN_ML, WATER_SIZE_MAX_ML]).toEqual([50, 3000]);
    expect(waterSizeEntry(String(DEFAULT_WATER_SIZES.glass_ml))).toBe(250);
    expect(waterSizeEntry(String(DEFAULT_WATER_SIZES.bottle_ml))).toBe(1000);
  });
  it('rounds, keeps 50 to 3000 and gives null otherwise', () => {
    expect(waterSizeEntry('50')).toBe(50);
    expect(waterSizeEntry('3000')).toBe(3000);
    expect(waterSizeEntry('49')).toBeNull();
    expect(waterSizeEntry('3001')).toBeNull();
    expect(waterSizeEntry('49.6')).toBe(50);
    expect(waterSizeEntry('49.4')).toBeNull();
    expect(waterSizeEntry('3000.4')).toBe(3000);
    expect(waterSizeEntry('3000.5')).toBeNull();
    expect(waterSizeEntry('330,4')).toBe(330);
    expect(waterSizeEntry('')).toBeNull();
    expect(waterSizeEntry('abc')).toBeNull();
    expect(waterSizeEntry('-250')).toBeNull();
  });
  it('matches the prototype for edge and random entries', () => {
    const texts = ['', ' ', 'abc', '0', '49', '49.4', '49.5', '49.6', '50', '250', '1e3', '2999.5', '3000', '3000.4', '3000.5', '3001', '-100', '330,4', '12 ml', 'Infinity'];
    for (let i = 0; i < 500; i++) texts.push((((i * 7919) % 70000) / 10 - 1000).toFixed(i % 3));
    for (const t of texts) expect(waterSizeEntry(t)).toBe(proto(t));
  });
});
