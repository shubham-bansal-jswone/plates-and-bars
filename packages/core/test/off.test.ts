import { offToUserFood, validateBarcode, unitGrams } from '../src';
import type { OffProduct } from '../src';

/** The live OFF response for Lay's 8901491101837 on 2026-10-18, trimmed to the spec's whitelist, values as posted. */
const LAYS: OffProduct = {
  code: '8901491101837',
  product_name: 'Lays Classics Salted 20rs',
  brands: "Lay's",
  quantity: '50g',
  completeness: 0.8875,
  countries_tags: ['en:india'],
  data_quality_errors_tags: [],
  states_tags: ['en:to-be-completed', 'en:nutrition-facts-completed', 'en:ingredients-completed'],
  nutriments: {
    'added-sugars_100g': 0.51,
    carbohydrates_100g: 51.7,
    'energy-kcal_100g': 554,
    'energy-kj_100g': 2311.4,
    fat_100g: 35.5,
    fiber_100g: 0,
    proteins_100g: 7,
    sugars_100g: 2.6,
  },
};

function ok(p: OffProduct) {
  const r = offToUserFood(p);
  if (r.kind !== 'ok') throw new Error('expected ok');
  return r;
}

describe('offToUserFood', () => {
  it('maps the live Lay\'s example per 100 g', () => {
    const r = ok(LAYS);
    expect(r.draft).toEqual({
      name: "Lays Classics Salted 20rs",
      unit: '100 g',
      kcal: 554,
      protein_g: 7,
      carbs_g: 51.7,
      fat_g: 35.5,
      fibre_g: 0,
      added_sugar_g: 0.5,
      fruit_veg_servings: null,
      origin: 'custom',
      barcode: '8901491101837',
    });
    expect(r.missing).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.liquid).toBe(false);
    expect(r.carbsFibreHint).toBe(false);
  });

  it('does not map total sugars to added sugar', () => {
    const p = { ...LAYS, nutriments: { ...LAYS.nutriments, 'added-sugars_100g': undefined } };
    expect(ok(p).draft.added_sugar_g).toBeNull();
  });

  it('never reads bare energy (kJ): a stray energy key is ignored', () => {
    const nutriments = { proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2, energy: 2311.4 } as unknown as OffProduct['nutriments'];
    const r = ok({ product_name: 'X', nutriments });
    expect(r.draft.kcal).toBeNull();
    expect(r.missing).toEqual(['kcal']);
  });

  it('converts kJ to kcal only when kcal is missing', () => {
    const kjOnly = ok({ product_name: 'X', nutriments: { 'energy-kj_100g': 2092, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 5 } });
    expect(kjOnly.draft.kcal).toBe(500);
    const both = ok({ product_name: 'X', nutriments: { 'energy-kcal_100g': 400, 'energy-kj_100g': 2092, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 5 } });
    expect(both.draft.kcal).toBe(400);
  });

  it('keeps a stated 0 kcal rather than falling back to kJ', () => {
    const r = ok({ product_name: 'Water', nutriments: { 'energy-kcal_100g': 0, 'energy-kj_100g': 100, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 } });
    expect(r.draft.kcal).toBe(0);
    expect(r.missing).toEqual([]);
  });

  it('leaves missing protein null and lists it, never 0', () => {
    const r = ok({ ...LAYS, nutriments: { ...LAYS.nutriments, proteins_100g: undefined } });
    expect(r.draft.protein_g).toBeNull();
    expect(r.missing).toEqual(['protein_g']);
  });

  it('treats negative, blank, non-numeric and null values as missing', () => {
    const r = ok({ product_name: 'X', nutriments: { 'energy-kcal_100g': '', proteins_100g: -3, carbohydrates_100g: 'abc', fat_100g: null, fiber_100g: '2.5' } });
    expect(r.draft).toMatchObject({ kcal: null, protein_g: null, carbs_g: null, fat_g: null, fibre_g: 2.5 });
    expect(r.missing).toEqual(['kcal', 'protein_g', 'carbs_g', 'fat_g']);
  });

  it('is not_found with no usable nutriment', () => {
    expect(offToUserFood({ product_name: 'X' })).toEqual({ kind: 'not_found' });
    expect(offToUserFood({ product_name: 'X', nutriments: {} })).toEqual({ kind: 'not_found' });
    expect(offToUserFood({ product_name: 'X', nutriments: { sugars_100g: 3 } })).toEqual({ kind: 'not_found' });
  });

  it('scales a serving-only label from per 100 g and puts (N g) in the unit', () => {
    const r = ok({ ...LAYS, serving_size: '1 pack', serving_quantity: 50 });
    expect(r.draft.unit).toBe('1 pack (50 g)');
    expect(unitGrams(r.draft.unit)).toBe(50);
    expect(r.draft).toMatchObject({ kcal: 277, protein_g: 3.5, carbs_g: 25.9, fat_g: 17.8, fibre_g: 0, added_sugar_g: 0.3 });
  });

  it('keeps a serving text that already carries the grams', () => {
    expect(ok({ ...LAYS, serving_size: '30 g', serving_quantity: '30' }).draft.unit).toBe('30 g');
  });

  it('rounds fractional serving grams in the label only', () => {
    const r = ok({ ...LAYS, serving_size: 'one handful', serving_quantity: 27.5 });
    expect(r.draft.unit).toBe('one handful (28 g)');
    expect(r.draft.kcal).toBe(Math.round(554 * 0.275));
  });

  it('falls back to "1 serving" when the serving text is empty', () => {
    expect(ok({ ...LAYS, serving_size: '  ', serving_quantity: 40 }).draft.unit).toBe('1 serving (40 g)');
  });

  it('trims a long serving text to 100 characters and keeps the grams suffix', () => {
    const unit = ok({ ...LAYS, serving_size: 'x'.repeat(300), serving_quantity: 40 }).draft.unit;
    expect(unit.length).toBeLessThanOrEqual(100);
    expect(unit.endsWith(' (40 g)')).toBe(true);
    const plain = ok({ ...LAYS, serving_size: `${'x'.repeat(120)} 40 g`, serving_quantity: 40 }).draft.unit;
    expect(plain.length).toBeLessThanOrEqual(100);
    expect(unitGrams(plain)).toBe(40);
  });

  it('ignores a serving quantity of 0 or less, or not a number', () => {
    for (const q of [0, -5, 'x', null]) expect(ok({ ...LAYS, serving_size: '1 pack', serving_quantity: q }).draft).toMatchObject({ unit: '100 g', kcal: 554 });
  });

  it('labels liquids per 100 ml and turns grams entry off', () => {
    const base: OffProduct = { product_name: 'Cola', quantity: '330 ml', nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 } };
    const r = ok(base);
    expect(r.liquid).toBe(true);
    expect(r.draft.unit).toBe('100 ml');
    expect(unitGrams(r.draft.unit)).toBe(0);
    const s = ok({ ...base, serving_size: '1 can (330 ml)', serving_quantity: 330 });
    expect(s.draft.unit).toBe('1 can (330 ml)');
    expect(s.draft.kcal).toBe(139);
    expect(unitGrams(s.draft.unit)).toBe(0);
    expect(ok({ ...base, quantity: '1 l' }).liquid).toBe(true);
    expect(ok({ ...base, quantity: '500 g' }).liquid).toBe(false);
  });

  it('names: adds the first brand unless already in the name; caps at 200; empty name is missing', () => {
    expect(ok({ ...LAYS, product_name: 'Classic', brands: "Lay's, Pepsico" }).draft.name).toBe("Classic (Lay's)");
    expect(ok({ ...LAYS, product_name: "Lay's Classic", brands: "Lay's" }).draft.name).toBe("Lay's Classic");
    expect(ok({ ...LAYS, product_name: 'Lays Classic', brands: "Lay's" }).draft.name).toBe('Lays Classic');
    expect(ok({ ...LAYS, product_name: 'Classic', brands: null }).draft.name).toBe('Classic');
    expect(ok({ ...LAYS, product_name: ' '.padEnd(5) + 'a'.repeat(250), brands: null }).draft.name).toHaveLength(200);
    const r = ok({ ...LAYS, product_name: '  ', brands: "Lay's" });
    expect(r.draft.name).toBe('');
    expect(r.missing).toEqual(['name']);
  });

  it('carries the barcode or null', () => {
    expect(ok({ ...LAYS, code: '' }).draft.barcode).toBeNull();
    expect(ok({ ...LAYS, code: undefined }).draft.barcode).toBeNull();
  });

  it('shows the carbs and fibre hint unless the product is listed for India', () => {
    expect(ok({ ...LAYS, countries_tags: ['en:france'] }).carbsFibreHint).toBe(true);
    expect(ok({ ...LAYS, countries_tags: null }).carbsFibreHint).toBe(true);
  });

  describe('plausibility and data quality', () => {
    it('warns when macros exceed 100 g per 100 g', () => {
      const r = ok({ ...LAYS, nutriments: { ...LAYS.nutriments, 'energy-kcal_100g': 700, proteins_100g: 40, carbohydrates_100g: 40, fat_100g: 30 } });
      expect(r.warnings).toContain('looks_off');
    });

    it('warns when stated kcal is far from the macros, and keeps the values', () => {
      const r = ok({ ...LAYS, nutriments: { ...LAYS.nutriments, 'energy-kcal_100g': 120 } });
      expect(r.warnings).toEqual(['looks_off']);
      expect(r.draft.kcal).toBe(120);
    });

    it('does not warn inside the tolerance (both the 50 kcal and 40 percent bounds)', () => {
      // diff 60 of 200 kcal is 30 percent: not off. diff 40 of 50 kcal is 80 percent but under 50 kcal: not off.
      const macros = { proteins_100g: 10, carbohydrates_100g: 10, fat_100g: 10 }; // 170 kcal
      expect(ok({ product_name: 'A', nutriments: { ...macros, 'energy-kcal_100g': 230 } }).warnings).toEqual([]);
      expect(ok({ product_name: 'A', nutriments: { proteins_100g: 3, carbohydrates_100g: 0, fat_100g: 0, 'energy-kcal_100g': 52 } }).warnings).toEqual([]);
      expect(ok({ product_name: 'A', nutriments: { ...macros, 'energy-kcal_100g': 90 } }).warnings).toEqual(['looks_off']);
    });

    it('skips the energy check when a macro is missing', () => {
      expect(ok({ product_name: 'A', nutriments: { 'energy-kcal_100g': 900, proteins_100g: 1, carbohydrates_100g: 1 } }).warnings).toEqual([]);
    });

    it('warns on low completeness, quality errors and nutrition to be completed', () => {
      const r = ok({ ...LAYS, completeness: 0.49, data_quality_errors_tags: ['en:x'], states_tags: ['en:nutrition-facts-to-be-completed'] });
      expect(r.warnings).toEqual(['low_completeness', 'quality_errors', 'nutrition_to_be_completed']);
      expect(ok({ ...LAYS, completeness: 0.5 }).warnings).toEqual([]);
      expect(ok({ ...LAYS, completeness: '0.2' }).warnings).toEqual(['low_completeness']);
      expect(ok({ ...LAYS, completeness: null, data_quality_errors_tags: null, states_tags: null }).warnings).toEqual([]);
    });
  });
});

describe('validateBarcode', () => {
  it('accepts the Lay\'s EAN-13 and other valid codes', () => {
    expect(validateBarcode('8901491101837')).toEqual({ ok: true, format: 'EAN-13', code: '8901491101837' });
    expect(validateBarcode('4006381333931')).toMatchObject({ ok: true, format: 'EAN-13' });
    expect(validateBarcode('036000291452')).toMatchObject({ ok: true, format: 'UPC-A' });
    expect(validateBarcode('73513537')).toMatchObject({ ok: true, format: 'EAN-8' });
  });

  it('accepts UPC-E by expanding to UPC-A for each last-digit rule', () => {
    // 042100005264 (UPC-A) is 04252614 (UPC-E, last digit 1).
    expect(validateBarcode('04252614')).toMatchObject({ ok: true, format: 'UPC-E' });
    expect(validateBarcode('04252615')).toEqual({ ok: false, reason: 'check_digit' });
    // One per other last-digit rule through its UPC-A form (0, 3, 4 differ from the EAN-8 weights).
    for (const last of ['0', '3', '4']) expect(validateBarcode(findUpcE(last))).toMatchObject({ ok: true, format: 'UPC-E' });
    // With a last digit of 5 to 9 the UPC-E check equals the EAN-8 check, so a valid code reads as EAN-8.
    expect(validateBarcode('01234565')).toMatchObject({ ok: true, format: 'EAN-8' });
    expect(validateBarcode('01234560')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('21234565')).toEqual({ ok: false, reason: 'check_digit' });
  });

  it('rejects a bad check digit', () => {
    expect(validateBarcode('8901491101838')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('036000291453')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('73513538')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('23513538')).toEqual({ ok: false, reason: 'check_digit' });
  });

  it('keeps leading zeros as typed: UPC-A and its zero-padded EAN-13 are both valid, a stripped code is not', () => {
    expect(validateBarcode('0036000291452')).toMatchObject({ ok: true, format: 'EAN-13' });
    expect(validateBarcode('36000291452')).toEqual({ ok: false, reason: 'length' });
    expect(validateBarcode('00000000')).toMatchObject({ ok: true, format: 'EAN-8' });
  });

  it('rejects non-digits, spaces and other lengths', () => {
    for (const c of ['', ' 8901491101837', '8901491101837 ', '89014911018x7', '8901-4911']) expect(validateBarcode(c)).toEqual({ ok: false, reason: 'not_digits' });
    for (const c of ['1234567', '123456789', '12345678901', '12345678901234']) expect(validateBarcode(c)).toEqual({ ok: false, reason: 'length' });
  });
});

/** A valid 8-digit UPC-E ending its body in `last`, found by trying check digits against the UPC-A check rule. */
function findUpcE(last: string): string {
  for (let body = 0; body < 100000; body++) {
    const mid = String(body).padStart(5, '0');
    for (let chk = 0; chk < 10; chk++) {
      const e = `0${mid}${last}${chk}`;
      const r = validateBarcode(e);
      if (r.ok && r.format === 'UPC-E') return e;
    }
  }
  throw new Error('none for ' + last);
}
