import { offToUserFood, validateBarcode, expandUpcE, unitGrams } from '../src';
import type { OffProduct } from '../src';

/** The live OFF response for Lay's 8901491101837 on 2026-10-18, trimmed to the spec's whitelist, values as posted. */
const LAYS: OffProduct = {
  code: '8901491101837',
  name: 'Lays Classics Salted 20rs',
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
  it('reads a contract-shaped product (#959 OffProduct field names, name not product_name)', () => {
    const contract = {
      code: '8901491101837',
      name: "Lay's Classic",
      brands: "Lay's",
      quantity: '50g',
      serving_size: null,
      serving_quantity: null,
      nutrition_data_per: '100g' as const,
      nutriments: { 'energy-kcal_100g': 554, proteins_100g: 7, carbohydrates_100g: 51.7, fat_100g: 35.5, fiber_100g: 0, 'added-sugars_100g': 0.51 },
      completeness: 0.8875,
      states_tags: ['en:nutrition-facts-completed'],
      data_quality_errors_tags: [],
      countries_tags: ['en:india'],
      last_modified_at: '2026-10-01T00:00:00Z',
      source: { code: 'open_food_facts' },
    };
    const r = ok(contract);
    expect(r.draft.name).toBe("Lay's Classic");
    expect(r.missing).toEqual([]);
  });

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
    const r = ok({ name: 'X', nutriments });
    expect(r.draft.kcal).toBeNull();
    expect(r.missing).toEqual(['kcal']);
  });

  it('converts kJ to kcal only when kcal is missing', () => {
    const kjOnly = ok({ name: 'X', nutriments: { 'energy-kj_100g': 2092, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 5 } });
    expect(kjOnly.draft.kcal).toBe(500);
    const both = ok({ name: 'X', nutriments: { 'energy-kcal_100g': 400, 'energy-kj_100g': 2092, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 5 } });
    expect(both.draft.kcal).toBe(400);
  });

  it('keeps a stated 0 kcal rather than falling back to kJ', () => {
    const r = ok({ name: 'Water', nutriments: { 'energy-kcal_100g': 0, 'energy-kj_100g': 100, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 } });
    expect(r.draft.kcal).toBe(0);
    expect(r.missing).toEqual([]);
  });

  it('leaves missing protein null and lists it, never 0', () => {
    const r = ok({ ...LAYS, nutriments: { ...LAYS.nutriments, proteins_100g: undefined } });
    expect(r.draft.protein_g).toBeNull();
    expect(r.missing).toEqual(['protein_g']);
  });

  it('treats negative, blank, non-numeric and null values as missing', () => {
    const r = ok({ name: 'X', nutriments: { 'energy-kcal_100g': '', proteins_100g: -3, carbohydrates_100g: 'abc', fat_100g: null, fiber_100g: '2.5' } });
    expect(r.draft).toMatchObject({ kcal: null, protein_g: null, carbs_g: null, fat_g: null, fibre_g: 2.5 });
    expect(r.missing).toEqual(['kcal', 'protein_g', 'carbs_g', 'fat_g']);
  });

  it('is not_found with no usable nutriment', () => {
    expect(offToUserFood({ name: 'X' })).toEqual({ kind: 'not_found' });
    expect(offToUserFood({ name: 'X', nutriments: {} })).toEqual({ kind: 'not_found' });
    expect(offToUserFood({ name: 'X', nutriments: { sugars_100g: 3 } })).toEqual({ kind: 'not_found' });
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

  it('keeps the grams entry equal to serving_quantity for every probe (reviewer probes on #961)', () => {
    const probes: Array<[string, number, string]> = [
      ['2 biscuits (30 g)', 15, '15 g (2 biscuits (30 g))'],
      ['1 pack (2 x 15 g)', 30, '30 g (1 pack (2 x 15 g))'],
      ['2 x 15 g', 30, '30 g (2 x 15 g)'],
      ['1 pack', 30, '1 pack (30 g)'],
      ['', 30, '1 serving (30 g)'],
      ['1250 g tub', 1250, '1250 g tub'],
    ];
    for (const [text, qty, unit] of probes) {
      const r = ok({ ...LAYS, serving_size: text, serving_quantity: qty });
      expect(r.draft.unit).toBe(unit);
      expect(unitGrams(r.draft.unit)).toBe(qty);
      expect(r.draft.kcal).toBe(Math.round((554 * qty) / 100));
    }
  });

  it('puts the grams first when the long text would hide the suffix, and never exceeds 100 characters', () => {
    const r = ok({ ...LAYS, serving_size: `${'x'.repeat(95)} 12 g`, serving_quantity: 40 });
    expect(r.draft.unit.length).toBeLessThanOrEqual(100);
    expect(unitGrams(r.draft.unit)).toBe(40);
  });

  it('falls back to per 100 g when the serving weight is not whole grams (2.5 g, 27.5 g, 0.06 g)', () => {
    for (const [text, qty] of [['2.5 g', 2.5], ['one handful', 27.5], ['1 tablet', 0.06]] as const) {
      const r = ok({ ...LAYS, serving_size: text, serving_quantity: qty });
      expect(r.draft).toMatchObject({ unit: '100 g', kcal: 554, protein_g: 7 });
      expect(unitGrams(r.draft.unit)).toBe(100);
    }
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
    const base: OffProduct = { name: 'Cola', quantity: '330 ml', nutriments: { 'energy-kcal_100g': 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0 } };
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
    // No serving text: the unit carries the volume.
    expect(ok({ ...base, serving_quantity: 330 }).draft.unit).toBe('1 serving (330 ml)');
    expect(ok({ ...base, serving_quantity: 33.5 }).draft.unit).toBe('1 serving (33.5 ml)');
  });

  it('is not a liquid when the serving text also gives grams', () => {
    const base: OffProduct = { name: 'Shake', quantity: '250 ml', nutriments: { 'energy-kcal_100g': 60, proteins_100g: 3, carbohydrates_100g: 8, fat_100g: 2 } };
    const r = ok({ ...base, serving_size: '250 ml (250 g)', serving_quantity: 250 });
    expect(r.liquid).toBe(false);
    expect(unitGrams(r.draft.unit)).toBe(250);
    expect(ok({ ...base, serving_size: '1 cup 250 ml', serving_quantity: 250 }).liquid).toBe(true);
  });

  it('names: adds the first brand unless already in the name; caps at 200; empty name is missing', () => {
    expect(ok({ ...LAYS, name: 'Classic', brands: "Lay's, Pepsico" }).draft.name).toBe("Classic (Lay's)");
    expect(ok({ ...LAYS, name: "Lay's Classic", brands: "Lay's" }).draft.name).toBe("Lay's Classic");
    expect(ok({ ...LAYS, name: 'Lays Classic', brands: "Lay's" }).draft.name).toBe('Lays Classic');
    expect(ok({ ...LAYS, name: 'Classic', brands: null }).draft.name).toBe('Classic');
    expect(ok({ ...LAYS, name: ' '.padEnd(5) + 'a'.repeat(250), brands: null }).draft.name).toHaveLength(200);
    const r = ok({ ...LAYS, name: '  ', brands: "Lay's" });
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
      expect(ok({ name: 'A', nutriments: { ...macros, 'energy-kcal_100g': 230 } }).warnings).toEqual([]);
      expect(ok({ name: 'A', nutriments: { proteins_100g: 3, carbohydrates_100g: 0, fat_100g: 0, 'energy-kcal_100g': 52 } }).warnings).toEqual([]);
      expect(ok({ name: 'A', nutriments: { ...macros, 'energy-kcal_100g': 90 } }).warnings).toEqual(['looks_off']);
    });

    it('skips the energy check when a macro is missing', () => {
      expect(ok({ name: 'A', nutriments: { 'energy-kcal_100g': 900, proteins_100g: 1, carbohydrates_100g: 1 } }).warnings).toEqual([]);
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

  it('reads 8 typed digits as EAN-8 only, even when they are a valid UPC-E', () => {
    expect(validateBarcode('04252614')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('01234565')).toEqual({ ok: true, format: 'EAN-8', code: '01234565' });
    expect(validateBarcode('04252614', 'ean_8')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('8901491101837', 'upc_a')).toMatchObject({ ok: true, format: 'EAN-13' });
  });

  it('expands a scanned UPC-E to the 12-digit UPC-A to look up', () => {
    for (const [e, a] of UPC_E_TABLE) expect(validateBarcode(e, 'upc_e')).toEqual({ ok: true, format: 'UPC-A', code: a });
    expect(validateBarcode('01234560', 'upc_e')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('21234565', 'upc_e')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('036000291452', 'upc_e')).toEqual({ ok: false, reason: 'length' });
    expect(validateBarcode('0123456', 'upc_e')).toEqual({ ok: false, reason: 'length' });
    expect(validateBarcode('0123456x', 'upc_e')).toEqual({ ok: false, reason: 'not_digits' });
  });

  it('rejects a bad check digit', () => {
    expect(validateBarcode('8901491101838')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('036000291453')).toEqual({ ok: false, reason: 'check_digit' });
    expect(validateBarcode('73513538')).toEqual({ ok: false, reason: 'check_digit' });
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

/** Known UPC-E to UPC-A pairs, one per last-digit rule (0 to 2, 3, 4, 5 to 9); the contract's two vectors are the last two. */
const UPC_E_TABLE: Array<[string, string]> = [
  ['01234505', '012000003455'],
  ['01234514', '012100003454'],
  ['01234523', '012200003453'],
  ['01234531', '012300000451'],
  ['01234543', '012340000053'],
  ['01234558', '012345000058'],
  ['01234565', '012345000065'],
  ['04252614', '042100005264'],
];

describe('expandUpcE', () => {
  it('matches the fixed table', () => {
    for (const [e, a] of UPC_E_TABLE) expect(expandUpcE(e)).toBe(a);
  });

  it('is null for a bad check digit, number system 2 to 9, or the wrong shape', () => {
    for (const c of ['01234566', '21234565', '9123456', '012345650', '0123456x', '']) expect(expandUpcE(c)).toBeNull();
  });
});
