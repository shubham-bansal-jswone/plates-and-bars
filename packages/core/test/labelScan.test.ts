import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNutritionLabel, labelFood, labelToScannedInput } from '../src/labelScan';
import type { LabelDraft, LabelKey, LabelOcrInput } from '../src/labelScan';
import { unitGrams, scannedFood } from '../src';

/**
 * Label parser (#1067). The vectors are OCR text written for this slice (no photos), in test/labelScan.vectors.json.
 * `values` lists the fields that must be filled; every other field must be empty. Not in docs/spec/golden: the label
 * scan has no prototype function, so there is no generated fixture.
 */
interface Vector {
  id: string;
  input: string | { lines: LabelOcrInput };
  expect: {
    basis: LabelDraft['basis'];
    unit: string;
    values: Partial<Record<LabelKey, number | null>>;
    missing: string[];
    reviewable?: boolean;
    warn?: string[];
    level?: Partial<Record<LabelKey, string>>;
    notes?: Partial<Record<LabelKey, string>>;
    alternate?: { unit: string; values: Partial<Record<LabelKey, number>> };
    alternateEmpty?: boolean;
    noWarn?: string[];
  };
}

const vectors = JSON.parse(readFileSync(resolve(__dirname, 'labelScan.vectors.json'), 'utf8')) as Vector[];
const inputOf = (v: Vector): LabelOcrInput => (typeof v.input === 'string' ? v.input : v.input.lines);
const defined = (o: Record<string, number | null | undefined>): Record<string, number> => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== null)) as Record<string, number>;

describe('parseNutritionLabel: vectors', () => {
  it('has at least 25 vectors covering the required kinds', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(25);
    const ids = vectors.map((v) => v.id).join(' ');
    for (const kind of ['fssai', 'fda', 'dual-column', 'kj-only', 'ocr', 'partial', 'serving-only', 'junk']) expect(ids).toContain(kind);
  });

  it.each(vectors.map((v) => [v.id, v] as const))('%s', (_id, v) => {
    const d = parseNutritionLabel(inputOf(v));
    const e = v.expect;
    expect(d.basis).toBe(e.basis);
    expect(d.unit).toBe(e.unit);
    expect(d.values).toEqual(defined(e.values));
    expect(d.missing).toEqual(e.missing);
    if (e.reviewable !== undefined) expect(d.reviewable).toBe(e.reviewable);
    for (const w of e.warn ?? []) expect(d.warnings).toContain(w);
    for (const w of e.noWarn ?? []) expect(d.warnings).not.toContain(w);
    for (const [k, lv] of Object.entries(e.level ?? {})) expect(d.fields[k as LabelKey].level).toBe(lv);
    for (const [k, n] of Object.entries(e.notes ?? {})) expect(d.fields[k as LabelKey].notes).toContain(n);
    if (e.alternate) expect({ unit: d.alternate?.unit, values: d.alternate?.values }).toEqual(e.alternate);
    if (e.alternateEmpty) expect(d.alternate).toBeUndefined();
    if (e.basis !== 'per100') expect(d.alternate).toBeUndefined();
    // Every empty field has no value and every filled field has a level of high or medium.
    for (const [k, f] of Object.entries(d.fields)) {
      if (f.value === undefined) expect(['low', 'missing']).toContain(f.level);
      else expect(['high', 'medium']).toContain(f.level);
      expect(d.values[k as LabelKey]).toBe(f.value);
    }
  });

  it('is deterministic and does not change its input', () => {
    for (const v of vectors) {
      const input = inputOf(v);
      const before = JSON.stringify(input);
      expect(parseNutritionLabel(input)).toEqual(parseNutritionLabel(input));
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it('reads the same from a string, a list of strings and a list of lines', () => {
    const text = 'Nutrition Facts\nServing size 1 slice (28g)\nCalories 70\nTotal Fat 1g\nTotal Carbohydrate 13g\nProtein 3g';
    const a = parseNutritionLabel(text);
    expect(parseNutritionLabel(text.split('\n'))).toEqual(a);
    expect(parseNutritionLabel(text.split('\n').map((t) => ({ text: t })))).toEqual(a);
    expect(parseNutritionLabel(text.split('\n').map((t) => ({ words: t.split(' ').map((w) => ({ text: w, confidence: 100 })) })))).toEqual(a);
    expect(parseNutritionLabel('Nutrition Facts\r\nCalories 70\r\nTotal Fat 1g').values).toEqual({ kcal: 70, fat_g: 1 });
  });
});

describe('parseNutritionLabel: rules', () => {
  const PER100 = ['Nutrition Information', 'Per 100 g'];
  const parse = (...rows: string[]): LabelDraft => parseNutritionLabel([...PER100, ...rows]);

  it('takes kcal over kJ, and converts kJ with 4.184 rounded (as offToUserFood)', () => {
    expect(parse('Energy 999 kJ / 250 kcal').values.kcal).toBe(250);
    expect(parse('Energy 1000 kJ').values.kcal).toBe(239);
    expect(parse('Energy 1000 kJ').fields.kcal.notes).toContain('from_kj');
  });

  it('marks kcal and kJ that disagree as medium', () => {
    expect(parse('Energy 2000 kJ / 250 kcal').fields.kcal.level).toBe('medium');
  });

  it('reads a lone "Calories 250" row and ignores "Calories from Fat"', () => {
    const d = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 cup (240g)', 'Calories 250 Calories from Fat 110']);
    expect(d.values.kcal).toBe(250);
  });

  it('does not read sub rows as the total (sugars, saturated, trans)', () => {
    const d = parse('Total Fat 10 g', 'Saturated Fat 4 g', 'Carbohydrate 30 g', 'of which sugars 12 g');
    expect(d.values).toMatchObject({ fat_g: 10, carbs_g: 30, saturated_fat_g: 4, sugars_g: 12 });
    expect(d.values.added_sugar_g).toBeUndefined();
  });

  it('maps only added sugars to added_sugar_g, never total sugars', () => {
    expect(parse('Total Sugars 12 g').values.added_sugar_g).toBeUndefined();
    expect(parse('Includes 7g Added Sugars').values.added_sugar_g).toBe(7);
    expect(parse('of which added sugars 7.5 g').values.added_sugar_g).toBe(7.5);
  });

  it('does not map sodium or salt', () => {
    const d = parse('Sodium 400 mg', 'Salt 1.0 g');
    expect(d.values).toEqual({});
    expect(d.missing).toHaveLength(4);
  });

  it('reads mg and mcg into grams', () => {
    expect(parse('Dietary Fibre 2500 mg').values.fibre_g).toBe(2.5);
    expect(parse('Dietary Fibre 1000000 mcg').values.fibre_g).toBe(1);
  });

  it('reads a comma as thousands only as 1 to 3 digits then exactly three', () => {
    expect(parse('Energy 1,046 kJ').values.kcal).toBe(250);
    expect(parse('Dietary Fibre 0,125 g').values.fibre_g).toBe(0.1);
    expect(parse('Dietary Fibre 1,5 g').values.fibre_g).toBe(1.5);
  });

  it('treats a bare dash as zero (medium) and "Trace" as zero', () => {
    const d = parse('Total Fat -', 'Trans Fat Trace');
    expect(d.values.fat_g).toBe(0);
    expect(d.fields.fat_g.level).toBe('medium');
    expect(d.fields.fat_g.notes).toContain('dash_as_zero');
    expect(d.values.trans_fat_g).toBe(0);
    expect(parse('Total Fat less than 1 g').values.fat_g).toBe(0);
  });

  it('marks a row with several columns and too few numbers as ambiguous, empty', () => {
    const d = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Protein 10 g']);
    expect(d.fields.protein_g).toMatchObject({ value: undefined, level: 'low' });
    expect(d.fields.protein_g.notes).toContain('ambiguous_column');
  });

  it('marks a found row with no number as unreadable', () => {
    const d = parse('Protein');
    expect(d.fields.protein_g.notes).toEqual(['unreadable']);
    expect(d.missing).toContain('protein_g');
  });

  it('empties a number that is impossible per 100 g, and a serve value above the serve weight', () => {
    expect(parse('Total Fat 120 g').fields.fat_g.notes).toContain('out_of_range');
    expect(parse('Energy 3000 kcal').values.kcal).toBeUndefined();
    const d = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 bar (40g)', 'Calories 180', 'Protein 90g', 'Total Fat 6g']);
    expect(d.values.protein_g).toBeUndefined();
    expect(d.values.fat_g).toBe(6);
  });

  it('lowers every required field when macros do not match the energy (looksOff), per 100 g and per serving', () => {
    const d = parse('Energy 100 kcal', 'Protein 20 g', 'Carbohydrate 50 g', 'Total Fat 20 g');
    expect(d.warnings).toContain('looks_off');
    const s = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 bar (40g)', 'Calories 350', 'Protein 8g', 'Total Fat 5g', 'Total Carbohydrate 20g']);
    expect(s.warnings).toContain('looks_off');
    const ok = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 bar (40g)', 'Calories 157', 'Protein 8g', 'Total Fat 5g', 'Total Carbohydrate 20g']);
    expect(ok.warnings).not.toContain('looks_off');
    // No serving weight: the 100 g total rule must not fire on a 120 g serving.
    const big = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 plate', 'Calories 1200', 'Protein 50g', 'Total Fat 40g', 'Total Carbohydrate 140g']);
    expect(big.warnings).not.toContain('looks_off');
  });

  it('computes from the serving only when a per 100 g value cannot be read and the weight is known', () => {
    const d = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 450 kcal   135 kcal', 'Protein 1.0.5 g   3.0 g', 'Carbohydrate 70 g   21 g', 'Total Fat 15 g   4.5 g']);
    expect(d.values.protein_g).toBe(10);
    expect(d.fields.protein_g.level).toBe('medium');
    const noWeight = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve', 'Energy 450 kcal   135 kcal', 'Protein 1.0.5 g   3.0 g', 'Carbohydrate 70 g   21 g', 'Total Fat 15 g   4.5 g']);
    expect(noWeight.values.protein_g).toBeUndefined();
  });

  it('leaves the unit blank and warns when the basis or the serving weight is unknown', () => {
    const d = parseNutritionLabel(['Calories 90', 'Total Fat 4g', 'Total Carbohydrate 12g', 'Protein 1g']);
    expect(d.basis).toBe('unknown');
    expect(d.unit).toBe('');
    expect(d.warnings).toEqual(expect.arrayContaining(['basis_unknown', 'no_header']));
    expect(d.fields.kcal.level).toBe('medium');
  });

  it('makes the serving unit read back as the serving weight', () => {
    for (const [text, grams] of [['2/3 cup (55g)', 55], ['30 g', 30], ['1 cup (1,250 g)', 1250]] as const) {
      const d = parseNutritionLabel(['Nutrition Facts', `Serving size ${text}`, 'Calories 100', 'Total Fat 1g', 'Total Carbohydrate 1g', 'Protein 1g']);
      expect(unitGrams(d.unit)).toBe(grams);
    }
    const long = parseNutritionLabel(['Nutrition Facts', `Serving size ${'x'.repeat(150)} (55g)`, 'Calories 100', 'Total Fat 1g', 'Total Carbohydrate 1g', 'Protein 1g']);
    expect(long.unit).toBe('55 g');
    expect(long.unit.length).toBeLessThanOrEqual(100);
    const frac = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 tbsp (12.5g)', 'Calories 100', 'Total Fat 1g', 'Total Carbohydrate 1g', 'Protein 1g']);
    expect(frac.unit).toBe('');
    expect(frac.warnings).toContain('serving_grams_fractional');
    expect(frac.servingGrams).toBe(12.5);
  });

  it('uses 100 ml for a per 100 ml column', () => {
    expect(parseNutritionLabel(['Nutritional Information', 'Per 100 ml', 'Energy 40 kcal']).unit).toBe('100 ml');
  });

  it('weights confidence by the OCR word confidence and the row label', () => {
    const word = (text: string, confidence: number) => ({ text, confidence });
    const line = (...w: ReturnType<typeof word>[]) => ({ words: w });
    const mk = (labelConf: number, numConf: number) => parseNutritionLabel([line(word('Nutrition', 99), word('Information', 99)), line(word('Per', 99), word('100', 99), word('g', 99)), line(word('Protein', labelConf), word('12', numConf), word('g', 99))]);
    expect(mk(99, 99).fields.protein_g).toMatchObject({ level: 'high', confidence: 0.99 });
    expect(mk(99, 70).fields.protein_g).toMatchObject({ level: 'medium', confidence: 0.7 });
    expect(mk(99, 49).fields.protein_g).toMatchObject({ value: undefined, level: 'low' });
    expect(mk(40, 99).fields.protein_g.value).toBeUndefined();
    expect(mk(99, 0).values.protein_g).toBeUndefined();
  });

  it('clamps and ignores bad confidences', () => {
    const d = parseNutritionLabel([{ text: 'Nutrition Information', confidence: Number.NaN }, { text: 'Per 100 g', confidence: 500 }, { text: 'Protein 12 g', confidence: -5 }]);
    expect(d.values.protein_g).toBeUndefined();
    expect(parseNutritionLabel([{ text: 'Protein 12 g', confidence: Number.NaN }]).fields.protein_g.value).toBe(12);
    expect(parseNutritionLabel([{ words: [{ text: '' }, { text: 'Protein' }, { text: '12', confidence: Number.NaN }, { text: 'g' }] }]).fields.protein_g.value).toBe(12);
  });

  it('reports missing required fields in kcal, protein, carbs, fat order, and reviewable from two reads', () => {
    expect(parse('Total Fat 3 g', 'Protein 3 g').missing).toEqual(['kcal', 'carbs_g']);
    expect(parse('Total Fat 3 g', 'Protein 3 g').reviewable).toBe(true);
    expect(parse('Total Fat 3 g').reviewable).toBe(false);
  });

  it('reads rows that come before the header too, with a no_header warning; a header with no rows is not a table', () => {
    const d = parseNutritionLabel(['Energy 100 kcal', 'Protein 1 g', 'Nutrition Facts']);
    expect(d.values).toEqual({ kcal: 100, protein_g: 1 });
    expect(d.warnings).toContain('no_header');
    expect(parseNutritionLabel(['Nutrition Facts']).warnings).toEqual([]);
    const e = parseNutritionLabel(['Nutrition Facts', 'see leaflet', 'Protein 1 g', 'Energy 100 kcal']);
    expect(e.values.protein_g).toBe(1);
  });

  it('keeps the first of a repeated row', () => {
    expect(parse('Protein 5 g', 'Protein 9 g').values.protein_g).toBe(5);
  });

  it('keeps a zero as 0 and a zero-kcal drink is not looks off', () => {
    const d = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 can (355 mL)', 'Calories 0', 'Total Fat 0g', 'Total Carbohydrate 0g', 'Protein 0g']);
    expect(d.values).toEqual({ kcal: 0, fat_g: 0, carbs_g: 0, protein_g: 0 });
    expect(d.warnings).not.toContain('looks_off');
  });
});

describe('labelFood / labelToScannedInput (the draft ends in scannedFood)', () => {
  const full = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 380 kcal', 'Protein 12 g', 'Carbohydrate 60 g', 'Total Fat 6 g', 'Dietary Fibre 8 g', 'Includes 5g Added Sugars']);

  it('gives a custom food with fibre and added sugar', () => {
    const r = labelFood(full, 'Muesli');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.food).toEqual({ name: 'Muesli', unit: '100 g', kcal: 380, protein_g: 12, carbs_g: 60, fat_g: 6, fibre_g: 8, added_sugar_g: 5, fruit_veg_servings: null, origin: 'custom' });
  });

  it('keeps empty fibre and added sugar as null', () => {
    const d = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 380 kcal', 'Protein 12 g', 'Carbohydrate 60 g', 'Total Fat 6 g']);
    const r = labelFood(d, 'Muesli');
    expect(r.kind === 'ok' && r.food.fibre_g).toBeNull();
    expect(r.kind === 'ok' && r.food.added_sugar_g).toBeNull();
  });

  it('reports the missing fields exactly as scannedFood does, and a real 0 passes', () => {
    const d = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 380 kcal', 'Protein 12 g', 'Total Fat Nil']);
    expect(labelFood(d, 'X')).toEqual({ kind: 'missing', fields: ['carbs_g'] });
    expect(d.missing).toEqual(['carbs_g']);
    expect(labelFood(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 0 kcal', 'Protein 0 g', 'Carbohydrate 0 g', 'Total Fat Nil']), 'Water').kind).toBe('ok');
  });

  it('passes name errors through and blank unit becomes "1 serving"', () => {
    expect(labelFood(full, '  ').kind).toBe('no-name');
    expect(labelFood(full, 'x'.repeat(201)).kind).toBe('name-too-long');
    const d = parseNutritionLabel(['Calories 90', 'Total Fat 4g', 'Total Carbohydrate 12g', 'Protein 1g']);
    const r = labelFood(d, 'Cookie');
    expect(r.kind === 'ok' && r.food.unit).toBe('1 serving');
    expect(labelToScannedInput(d, 'Cookie')).toEqual({ name: 'Cookie', kcal: 90, protein: 1, carbs: 12, fat: 4, qty: 1, unit: '' });
    expect(scannedFood(labelToScannedInput(d, 'Cookie')).kind).toBe('ok');
  });
});

describe('parseNutritionLabel: review of #1073', () => {
  const PER100 = ['Nutrition Information', 'Per 100 g', 'Energy 400 kcal'];
  const parse = (...rows: string[]): LabelDraft => parseNutritionLabel([...PER100, ...rows]);

  it('a label followed by an unmapped nutrient line always comes back empty', () => {
    for (const other of ['Vitamin D 2mcg 10%', 'Sodium 400 mg', 'Cholesterol 5mg 2%', 'Iron 1.2mg 6%', 'Calcium 40 mg', 'Salt 1.0 g']) {
      for (const [label, key] of [['Protein', 'protein_g'], ['Total Fat', 'fat_g'], ['Carbohydrate', 'carbs_g'], ['Energy', 'kcal'], ['Dietary Fibre', 'fibre_g']] as const) {
        const d = parseNutritionLabel(['Nutrition Information', 'Per 100 g', label, other]);
        expect([other, label, d.fields[key].value]).toEqual([other, label, undefined]);
      }
    }
  });

  it('still joins a label with a numbers-only line, with %, nil and units', () => {
    expect(parse('Protein', '7.0 g 14%').values.protein_g).toBe(7);
    expect(parse('Total Fat', 'Nil').values.fat_g).toBe(0);
    expect(parse('Protein', '(7 g)').values.protein_g).toBe(7);
  });

  it('never pairs stacked labels with the numbers below them', () => {
    const d = parse('Protein 10 g', 'Carbohydrate', 'Fat', 'Dietary Fibre', '30', '5', '2');
    expect(d.values).toEqual({ kcal: 400, protein_g: 10 });
  });

  it('reads added sugar only from the number attached to the phrase', () => {
    expect(parse('Total Sugars 12g Includes 10g Added Sugars 20%').values.added_sugar_g).toBe(10);
    expect(parse('Includes 10g Added Sugars').values.added_sugar_g).toBe(10);
    expect(parse('Added Sugars 10g 20%').values.added_sugar_g).toBe(10);
    expect(parse('Sugars 25 g, Added Sugars 10 g').values.added_sugar_g).toBe(10);
    expect(parse('Total Sugars 25 g Added Sugars').values.added_sugar_g).toBeUndefined();
    expect(parse('Added Sugars', '3 g').values.added_sugar_g).toBe(3);
  });

  it('decides the level from the unrounded confidence (0.495 is empty)', () => {
    const w = (text: string, confidence: number) => ({ text, confidence });
    const d = parseNutritionLabel([{ words: [w('Nutrition', 99), w('Information', 99)] }, { words: [w('Per', 99), w('100', 99), w('g', 99)] }, { words: [w('Protein', 99), w('l0', 66), w('g', 99)] }]);
    expect(d.fields.protein_g.value).toBeUndefined();
    expect(d.fields.protein_g.level).toBe('low');
    expect(d.fields.protein_g.confidence).toBe(0.5);
  });

  it('gives the alternate the same fields, levels and checks as the main read', () => {
    const d = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 450 kcal   135 kcal', 'Protein 10 g   3.6 g', 'Carbohydrate 70 g   21 g', 'Total Fat 15 g   4.5 g']);
    expect(d.alternate?.fields.protein_g).toMatchObject({ value: 3.6, level: 'medium' });
    expect(d.alternate?.fields.protein_g.notes).toContain('serving_mismatch');
    expect(d.alternate?.fields.kcal).toMatchObject({ value: 135, level: 'high' });
    expect(d.alternate?.warnings).toContain('serving_mismatch');
    expect(d.alternate?.fields.fibre_g.level).toBe('missing');
    const out = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 450 kcal   135 kcal', 'Protein 10 g   3 g', 'Carbohydrate 70 g   21 g', 'Total Fat 15 g   45 g']);
    expect(out.alternate?.values.fat_g).toBeUndefined();
    expect(out.alternate?.fields.fat_g.notes).toContain('out_of_range');
    const off = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 450 kcal   135 kcal', 'Protein 10 g   3 g', 'Carbohydrate 70 g   21 g', 'Total Fat 15 g   4.5 g', 'Dietary Fibre 75 g   22.5 g']);
    expect(off.alternate?.warnings).toContain('fibre_exceeds_carbs');
  });

  it('empties a swapped-column read (about 11x off) in both reads, and keeps a 10 to 2x gap as medium', () => {
    const swapped = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 135 kcal   450 kcal', 'Protein 3 g   10 g']);
    expect(swapped.values.protein_g).toBeUndefined();
    expect(swapped.fields.protein_g.notes).toContain('serving_mismatch');
    expect(swapped.alternate).toBeUndefined();
    const soft = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 450 kcal   135 kcal', 'Protein 10 g   4.5 g']);
    expect(soft.fields.protein_g).toMatchObject({ value: 10, level: 'medium' });
    const edge = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 450 kcal   135 kcal', 'Protein 10 g   6.1 g']);
    expect(edge.values.protein_g).toBeUndefined();
  });

  it('splits a line that holds two rows, but not "Saturated Fat" or "Total Fat"', () => {
    const d = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Protein 8 g Fat 24 g', 'Total Fat 24 g Saturated Fat 10 g', 'Calories 250 Calories from Fat 110']);
    expect(d.values).toMatchObject({ protein_g: 8, fat_g: 24, saturated_fat_g: 10, kcal: 250 });
  });

  it('reads a dot as the thousands separator in kJ only, and never gives 0 kcal for a lost digit', () => {
    expect(parse('Energy 1.046 kJ').values.kcal).toBe(400);
    expect(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 1.046 kJ']).values.kcal).toBe(250);
    expect(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 1.5 kJ']).values.kcal).toBeUndefined();
    expect(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 0 kJ']).values.kcal).toBe(0);
  });

  it('ignores "Fat Cal." and "Calories from fat" lines', () => {
    const d = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 cup (55g)', 'Calories 230', 'Calories from Fat 90', 'Fat Cal. 20', 'Total Fat 2g']);
    expect(d.values).toMatchObject({ kcal: 230, fat_g: 2 });
  });

  it('accepts a decimal serving weight for the checks and keeps the unit blank', () => {
    const d = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 scoop (32.5 g)', 'Calories 130', 'Protein 25g', 'Total Fat 2g', 'Total Carbohydrate 5g']);
    expect(d.servingGrams).toBe(32.5);
    expect(d.unit).toBe('');
    expect(d.warnings).toContain('serving_grams_fractional');
    expect(d.warnings).not.toContain('serving_grams_missing');
    const dual = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (32.5 g)', 'Energy 400 kcal   130 kcal', 'Protein 77 g   25 g']);
    expect(dual.values).toMatchObject({ kcal: 400, protein_g: 77 });
    expect(dual.alternate?.unit).toBe('');
  });

  it('labelFood validates fibre and added sugar like the other fields', () => {
    const base = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Energy 380 kcal', 'Protein 12 g', 'Carbohydrate 60 g', 'Total Fat 6 g']);
    const withValues = (v: Partial<Record<LabelKey, number>>): LabelDraft => ({ ...base, values: { ...base.values, ...v } });
    expect(labelFood(withValues({ fibre_g: -5 }), 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood(withValues({ fibre_g: Number.NaN }), 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood(withValues({ fibre_g: Number.POSITIVE_INFINITY }), 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood(withValues({ added_sugar_g: -1 }), 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood(withValues({ added_sugar_g: 101 }), 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood(withValues({ fibre_g: 61 }), 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood(withValues({ fibre_g: 60, added_sugar_g: 0 }), 'X').kind).toBe('ok');
    const serv = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 bar (40g)', 'Calories 150', 'Protein 8g', 'Total Fat 5g', 'Total Carbohydrate 20g']);
    expect(labelFood({ ...serv, values: { ...serv.values, added_sugar_g: 41 } }, 'X')).toEqual({ kind: 'invalid' });
    expect(labelFood({ ...serv, values: { ...serv.values, added_sugar_g: 40 } }, 'X').kind).toBe('ok');
    const noWeight = { ...serv, servingGrams: null };
    expect(labelFood({ ...noWeight, values: { ...noWeight.values, added_sugar_g: 41 } }, 'X').kind).toBe('ok');
  });

  it('treats a leading-zero integer as a repaired (medium) number', () => {
    expect(parse('Total Fat 05 g').fields.fat_g).toMatchObject({ value: 5, level: 'medium' });
    expect(parse('Total Fat 0.5 g').fields.fat_g.level).toBe('high');
    expect(parse('Total Fat 0 g').fields.fat_g.level).toBe('high');
  });
});

describe('parseNutritionLabel: review round 2', () => {
  it('blocks a join when the next line has letters of any script', () => {
    for (const [label, other, key] of [['Protein', 'सोडियम 400 mg', 'protein_g'], ['Total Fat', 'सोडियम 400 mg', 'fat_g'], ['Total Fat', 'नमक 1.2 g', 'fat_g']] as const) {
      const d = parseNutritionLabel(['Nutrition Information', 'Per 100 g', label, other]);
      expect(d.fields[key].value).toBeUndefined();
    }
  });

  it('cross-checks a liquid in ml, and skips the check with a unit mismatch, capping at medium', () => {
    const swapped = parseNutritionLabel(['Nutritional Information', 'Per 100 ml   Per serving (200 ml)', 'Energy 124 kcal   62 kcal', 'Protein 6.4 g   3.2 g', 'Carbohydrate 9.6 g   4.8 g', 'Total Fat 6.8 g   3.4 g']);
    expect(swapped.values).toEqual({});
    const mismatch = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (200 ml)', 'Energy 62 kcal   124 kcal', 'Protein 3.2 g   6.4 g']);
    expect(mismatch.warnings).toContain('basis_serving_unit_mismatch');
    expect(mismatch.alternate?.warnings).toContain('basis_serving_unit_mismatch');
    expect(mismatch.fields.kcal.level).toBe('medium');
    expect(mismatch.fields.kcal.confidence).toBeLessThan(0.8);
  });

  it('fills a per 100 ml value from a ml serving only when the units agree', () => {
    const d = parseNutritionLabel(['Nutritional Information', 'Per 100 ml   Per serving (200 ml)', 'Energy 62 kcal   124 kcal', 'Protein 1.0.5 g   6.4 g']);
    expect(d.values.protein_g).toBe(3.2);
    const m = parseNutritionLabel(['Nutritional Information', 'Per 100 ml   Per serving (30 g)', 'Energy 62 kcal   19 kcal', 'Protein 1.0.5 g   1 g']);
    expect(m.values.protein_g).toBeUndefined();
  });

  it('empties energy under 5 kcal per 100 g only when the macros are 5 kcal or more', () => {
    const at = (kcal: string, ...macros: string[]) => parseNutritionLabel(['Nutrition Information', 'Per 100 g', `Energy ${kcal}`, ...macros]);
    expect(at('4 kcal', 'Protein 0 g', 'Carbohydrate 1.3 g').fields.kcal).toMatchObject({ value: undefined, level: 'low', confidence: 0 });
    expect(at('4 kcal', 'Protein 0 g', 'Carbohydrate 1.3 g').fields.kcal.notes).toContain('out_of_range');
    expect(at('4 kcal', 'Protein 0 g', 'Carbohydrate 1.3 g').missing).toContain('kcal');
    expect(at('4 kcal', 'Protein 0 g', 'Carbohydrate 1.1 g').values.kcal).toBe(4); // 4.4 kcal of macros
    expect(at('0 kcal', 'Protein 0.3 g', 'Carbohydrate 1 g').values.kcal).toBeUndefined();
    expect(at('5 kcal', 'Total Fat 3 g').values.kcal).toBe(5);
    const serv = parseNutritionLabel(['Nutrition Facts', 'Serving size 1 cup (240g)', 'Calories 1', 'Total Fat 3g']);
    expect(serv.values.kcal).toBeUndefined();
  });

  it('keeps correct values when the serving value is rounded to 0 or "<1 g"', () => {
    const d = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (5 g)', 'Energy 400 kcal   20 kcal', 'Protein 7 g   0 g', 'Total Fat 20 g   1 g', 'Sugars 9 g   <1 g']);
    expect(d.values).toMatchObject({ protein_g: 7, fat_g: 20, sugars_g: 9 });
    // 9 g per 100 g at 20 g is 1.8 g per serving, not under 1 g: "<1 g" is a mismatch there.
    const far = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (20 g)', 'Energy 400 kcal   80 kcal', 'Sugars 9 g   <1 g']);
    expect(far.fields.sugars_g.notes).toContain('serving_mismatch');
    // A per serving 0 against a real per 100 g value of 2 g or more is a swap, not rounding.
    const zero = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (30 g)', 'Energy 400 kcal   120 kcal', 'Protein 10 g   0 g']);
    expect(zero.values.protein_g).toBeUndefined();
  });

  it('empties both reads on a whole swap at 71 to 141 g, and not when only some rows disagree', () => {
    for (const w of [75, 80, 100 / 0.8 * 1, 120, 140]) {
      const k = (x: number) => Math.round(x * 100) / 100;
      const per = { kcal: 400, p: 10, c: 50, f: 20 };
      const sw = parseNutritionLabel(['Nutritional Information', `Per 100 g   Per serve (${w} g)`, `Energy ${k(per.kcal * w / 100)} kcal   400 kcal`, `Protein ${k(per.p * w / 100)} g   10 g`, `Carbohydrate ${k(per.c * w / 100)} g   50 g`, `Total Fat ${k(per.f * w / 100)} g   20 g`]);
      expect(sw.values).toEqual({});
      expect(sw.alternate).toBeUndefined();
    }
    // Only protein disagrees: the other three rows are right, so this is not a whole swap.
    const some = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (80 g)', 'Energy 400 kcal   320 kcal', 'Protein 8 g   10 g', 'Carbohydrate 50 g   40 g', 'Total Fat 20 g   16 g']);
    expect(some.values).toMatchObject({ kcal: 400, carbs_g: 50, fat_g: 20 });
    // A 100 g serving cannot be told apart, and is not emptied.
    const same = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (100 g)', 'Energy 400 kcal   400 kcal', 'Protein 10 g   10 g', 'Carbohydrate 50 g   50 g', 'Total Fat 20 g   20 g']);
    expect(same.values.kcal).toBe(400);
  });

  it('splits at "of which" and "saturates", and at "sugars" after a carbohydrate number', () => {
    const d = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Carbohydrate 60 g of which sugars 25 g', 'Fat 20 g of which saturates 8 g', 'Protein 10 g Total Sugars 3 g']);
    expect(d.values).toMatchObject({ carbs_g: 60, sugars_g: 25, fat_g: 20, saturated_fat_g: 8, protein_g: 10 });
    const added = parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Total Sugars 12g Includes 10g Added Sugars 20%']);
    expect(added.values.added_sugar_g).toBe(10);
    expect(added.values.sugars_g).toBeUndefined();
  });

  it('does not join a mg-only line onto a macro, but does onto fibre', () => {
    expect(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Protein', '400 mg']).values.protein_g).toBeUndefined();
    expect(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Total Fat', '2 mcg']).values.fat_g).toBeUndefined();
    expect(parseNutritionLabel(['Nutrition Information', 'Per 100 g', 'Protein', '7 g', 'Dietary Fibre', '500 mg']).values).toEqual({ protein_g: 7, fibre_g: 0.5 });
  });

  it('gives the alternate the same unit and fractional-serving warning as the main read', () => {
    const d = parseNutritionLabel(['Nutritional Information', 'Per 100 g   Per serve (32.5 g)', 'Energy 400 kcal   130 kcal', 'Protein 77 g   25 g']);
    expect(d.alternate?.unit).toBe('');
    expect(d.alternate?.warnings).toContain('serving_grams_fractional');
    expect(d.alternate).not.toHaveProperty('missing');
    expect(d.alternate).not.toHaveProperty('reviewable');
  });
});

describe('parseNutritionLabel: review round 3', () => {
  it('never puts a column header in the serving unit', () => {
    for (const head of ['Serving size 30 g   Per 100 g   Per serve', 'Serving size 1 cup (30 g) Per 100 g Per serving']) {
      const d = parseNutritionLabel(['Nutritional Information', head, 'Energy 450 kcal   135 kcal', 'Protein 10 g   3 g']);
      expect(d.unit).toBe('100 g');
      expect(d.alternate?.unit).not.toMatch(/per/i);
      expect(unitGrams(d.alternate?.unit ?? '')).toBe(30);
    }
    const only = parseNutritionLabel(['Nutrition Facts', 'Serving size 2/3 cup (55g) Amount per serving', 'Calories 230', 'Total Fat 8g']);
    expect(only.unit).toBe('2/3 cup (55g)');
  });

  it('a whole swap needs at least 3 non-neutral required fields, and any normal match means no swap', () => {
    const rows = (e: string, p: string, c: string, f: string) => ['Nutritional Information', 'Per 100 g   Per serve (120 g)', e, p, c, f];
    // Only two non-neutral fields (the rest are 0 in both columns): not a whole swap by this rule.
    const two = parseNutritionLabel(rows('Energy 48 kcal   40 kcal', 'Protein 4.2 g   3.5 g', 'Carbohydrate 0 g   0 g', 'Total Fat 0 g   0 g'));
    expect(two.fields.kcal.notes).toContain('serving_mismatch');
    // One field matches normally: kcal, protein and carbs look swapped but fat is right, so no whole swap (each is still flagged).
    const mixed = parseNutritionLabel(rows('Energy 48 kcal   40 kcal', 'Protein 4.2 g   3.5 g', 'Carbohydrate 6 g   5 g', 'Total Fat 10 g   12 g'));
    expect(mixed.fields.fat_g.value).toBe(10);
    expect(mixed.fields.fat_g.notes).not.toContain('serving_mismatch');
  });
});

/** A small seeded generator (mulberry32) so the fuzz runs are the same every time. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseNutritionLabel: fuzz', () => {
  const alphabet = 'ProteinFatEnergyCalories Carbohydrate0123456789.,<>%|-–()/ gmkcalJOlI\n\t ®€µ';
  it('never throws, and every filled field is finite, non-negative and consistent, on random text', () => {
    const r = rng(1067);
    for (let i = 0; i < 1500; i++) {
      let s = '';
      const n = Math.floor(r() * 200);
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(r() * alphabet.length)];
      const d = parseNutritionLabel(s);
      for (const f of Object.values(d.fields)) {
        if (f.value !== undefined) {
          expect(Number.isFinite(f.value)).toBe(true);
          expect(f.value).toBeGreaterThanOrEqual(0);
          expect(f.confidence).toBeGreaterThanOrEqual(0.5);
        }
        expect(f.confidence).toBeLessThanOrEqual(1);
      }
      expect(d.missing.every((k) => d.values[k] === undefined)).toBe(true);
    }
  });

  it('gives the same read for the same random line list (pure)', () => {
    const r = rng(7);
    const rows = ['Energy 400 kcal', 'Protein 12 g', 'Carbohydrate 60 g', 'Total Fat 10 g', 'Dietary Fibre 3 g'];
    for (let i = 0; i < 200; i++) {
      const lines = ['Nutrition Information', 'Per 100 g', ...rows.filter(() => r() < 0.7)];
      expect(parseNutritionLabel(lines)).toEqual(parseNutritionLabel([...lines]));
    }
  });

  it('never fills a field when every OCR confidence drops (confidence only removes values)', () => {
    const r = rng(99);
    for (const v of vectors) {
      const text = typeof v.input === 'string' ? v.input : null;
      if (text === null) continue;
      const hi = parseNutritionLabel(text.split('\n').map((t) => ({ text: t, confidence: 95 })));
      const lo = parseNutritionLabel(text.split('\n').map((t) => ({ text: t, confidence: Math.floor(r() * 45) })));
      for (const k of Object.keys(lo.values) as LabelKey[]) expect(hi.values[k]).toBe(lo.values[k]);
      expect(Object.keys(lo.values).length).toBeLessThanOrEqual(Object.keys(hi.values).length);
      expect(Object.keys(lo.values)).toHaveLength(0);
    }
  });

  it('never returns a wrong number when the corrupted word has low OCR confidence', () => {
    const r = rng(2026);
    const base = ['Nutrition Information', 'Per 100 g', 'Energy 400 kcal', 'Protein 12.0 g', 'Carbohydrate 60.0 g', 'Total Fat 10.0 g'];
    const truth = { kcal: 400, protein_g: 12, carbs_g: 60, fat_g: 10 } as const;
    const junk = 'O l I 9 8 , . % ~ | x 1 7'.split(' ');
    for (let i = 0; i < 1500; i++) {
      const li = 2 + Math.floor(r() * 4);
      const lines = base.map((text, n) => {
        const words = text.split(' ');
        if (n !== li) return { words: words.map((w) => ({ text: w, confidence: 96 })) };
        const wi = Math.floor(r() * words.length);
        const w = words[wi] as string;
        const at = Math.floor(r() * w.length);
        words[wi] = w.slice(0, at) + (junk[Math.floor(r() * junk.length)] as string) + w.slice(at + 1);
        return { words: words.map((x, k) => ({ text: x, confidence: k === wi ? 30 : 96 })) };
      });
      const d = parseNutritionLabel(lines);
      for (const k of Object.keys(truth) as (keyof typeof truth)[]) {
        if (d.fields[k].value !== undefined) expect(d.fields[k].value).toBe(truth[k]);
      }
    }
  });
});
