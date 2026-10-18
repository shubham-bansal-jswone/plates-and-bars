import { myFoodReplaced, customFood, normaliseBarcode, sameBarcode, saveMyFood, saveScannedFood, scannedFood, MY_FOODS_MAX } from '../src/index';

type F = { name: string; barcode?: string | null; id?: string };
const UPC_A = '042100005264';
const EAN13 = `0${UPC_A}`;
const OTHER = '5000112637922';

describe('normaliseBarcode and sameBarcode (#944)', () => {
  it('a 12-digit UPC-A and its leading-0 EAN-13 are one product', () => {
    expect(normaliseBarcode(UPC_A)).toBe(EAN13);
    expect(normaliseBarcode(EAN13)).toBe(EAN13);
    expect(normaliseBarcode('96385074')).toBe('96385074');
    expect(sameBarcode(UPC_A, EAN13)).toBe(true);
    expect(sameBarcode(EAN13, UPC_A)).toBe(true);
    expect(sameBarcode(UPC_A, UPC_A)).toBe(true);
    expect(sameBarcode(UPC_A, OTHER)).toBe(false);
  });
  it('a missing or empty code never matches', () => {
    expect(sameBarcode(undefined, undefined)).toBe(false);
    expect(sameBarcode(null, null)).toBe(false);
    expect(sameBarcode('', '')).toBe(false);
    expect(sameBarcode(UPC_A, null)).toBe(false);
  });
});

describe('saveScannedFood (#944)', () => {
  const bar = (over: Partial<F> = {}): F => ({ name: 'Peanut bar (Acme)', barcode: OTHER, id: 'a', ...over });
  it('goes first and replaces only the same product, even when renamed', () => {
    const list: F[] = [{ name: 'Rice' }, bar({ name: 'My bar' })];
    expect(saveScannedFood(list, bar({ id: 'b' }))).toEqual([bar({ id: 'b' }), { name: 'Rice' }]);
  });
  it('a second product with the same name keeps both', () => {
    const first = bar();
    const second = bar({ barcode: UPC_A, id: 'b' });
    expect(saveScannedFood([first], second)).toEqual([second, first]);
  });
  it('never drops a food with no barcode, even when the names match', () => {
    const custom: F = { name: 'Peanut bar (Acme)', id: 'c' };
    expect(saveScannedFood([custom], bar())).toEqual([bar(), custom]);
  });
  it('UPC-A and its 13-digit form are one product', () => {
    const saved = bar({ barcode: UPC_A });
    expect(saveScannedFood([saved], bar({ barcode: EAN13, id: 'b' }))).toEqual([bar({ barcode: EAN13, id: 'b' })]);
  });
  it('keeps 60', () => {
    const list: F[] = Array.from({ length: 60 }, (_, i) => ({ name: `F${i}` }));
    const r = saveScannedFood(list, bar());
    expect(r).toHaveLength(MY_FOODS_MAX);
    expect(r[0]).toEqual(bar());
  });
  it('a food without a barcode is saved as saveMyFood does', () => {
    expect(saveScannedFood([{ name: 'A', id: '1' }, bar({ name: 'A' })], { name: 'A', id: '2' })).toEqual([{ name: 'A', id: '2' }, bar({ name: 'A' })]);
  });
});

describe('saveMyFood and barcoded foods (#944)', () => {
  it('a plain save with the name of a scanned food does not replace it', () => {
    const scanned: F = { name: 'Peanut bar', barcode: OTHER, id: 's' };
    const plain: F = { name: 'Peanut bar', id: 'p' };
    expect(saveMyFood([scanned], plain)).toEqual([plain, scanned]);
  });
  it('still replaces a same-name food that has no barcode, or a null barcode', () => {
    expect(saveMyFood([{ name: 'X', barcode: null, id: '1' } as F, { name: 'Y' }], { name: 'X', id: '2' } as F)).toEqual([{ name: 'X', id: '2' }, { name: 'Y' }]);
  });
  it('a food with a barcode is saved by barcode, not by name', () => {
    const a: F = { name: 'Bar', barcode: OTHER, id: 'a' };
    const b: F = { name: 'Bar', barcode: UPC_A, id: 'b' };
    expect(saveMyFood([a], b)).toEqual([b, a]);
  });
});

describe('scannedFood (#944, #944 D4 item 6)', () => {
  const water = { name: 'Diet cola', kcal: 0, protein: 0, carbs: 0, fat: 0, qty: '', unit: '' };
  it('accepts a product whose calories and macros are all genuine zeros', () => {
    expect(scannedFood(water)).toEqual({
      kind: 'ok',
      log: { name: 'Diet cola', qty: 1, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      food: { name: 'Diet cola', unit: '1 serving', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' },
    });
    expect(scannedFood({ ...water, kcal: '0', protein: '0', carbs: '0,0', fat: '0' }).kind).toBe('ok');
    // customFood keeps the prototype rule for the Custom tab
    expect(customFood({ ...water, kcal: '0', protein: '0', carbs: '0', fat: '0' })).toEqual({ kind: 'no-kcal' });
  });
  it('a typed 0 kcal stays 0 and is not swapped for the macro estimate', () => {
    const r = scannedFood({ ...water, kcal: '0', protein: '10', carbs: '5', fat: '2' });
    expect(r).toMatchObject({ kind: 'ok', log: { kcal: 0 }, food: { kcal: 0 } });
    expect(customFood({ ...water, kcal: '0', protein: '10', carbs: '5', fat: '2' })).toMatchObject({ log: { kcal: 78 } });
  });
  it('a missing value is invalid, undefined, null, empty and junk alike', () => {
    const field = { kcal: 'kcal', protein: 'protein_g', carbs: 'carbs_g', fat: 'fat_g' } as const;
    for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) {
      for (const v of [undefined, null, '', '  ', 'abc']) expect(scannedFood({ ...water, [k]: v })).toEqual({ kind: 'missing', fields: [field[k]] });
    }
  });
  it('lists every missing field, in form order, so the app can flag each one', () => {
    expect(scannedFood({ ...water, kcal: '', fat: undefined, carbs: 0 })).toEqual({ kind: 'missing', fields: ['kcal', 'fat_g'] });
    expect(scannedFood({ ...water, kcal: null, protein: null, carbs: null, fat: null })).toEqual({ kind: 'missing', fields: ['kcal', 'protein_g', 'carbs_g', 'fat_g'] });
  });
  it('name and invalid checks come before missing', () => {
    expect(scannedFood({ ...water, name: '', kcal: '' })).toEqual({ kind: 'no-name' });
    expect(scannedFood({ ...water, fat: -1, kcal: '' })).toEqual({ kind: 'invalid' });
  });
  it('keeps customFood checks: name, length, negatives, quantity; and normal values', () => {
    expect(scannedFood({ ...water, name: ' ' })).toEqual({ kind: 'no-name' });
    expect(scannedFood({ ...water, name: 'a'.repeat(201) })).toEqual({ kind: 'name-too-long' });
    expect(scannedFood({ ...water, fat: -1 })).toEqual({ kind: 'invalid' });
    expect(scannedFood({ ...water, qty: '-2' })).toEqual({ kind: 'invalid' });
    expect(scannedFood({ ...water, qty: '0' })).toMatchObject({ kind: 'ok', log: { qty: 1 } });
    expect(scannedFood({ name: ' Bar ', kcal: '200,5', protein: 10, carbs: '20', fat: 8, qty: '2', unit: ' 1 bar (50 g) ' })).toMatchObject({
      kind: 'ok', log: { name: 'Bar', qty: 2, kcal: 200.5 }, food: { unit: '1 bar (50 g)' },
    });
  });
});

describe('myFoodReplaced agrees with both saves (#944)', () => {
  const a: F = { name: 'Bar', barcode: OTHER, id: 'a' };
  const upc: F = { name: 'Bar', barcode: UPC_A, id: 'u' };
  const custom: F = { name: 'Bar', id: 'c' };
  const nul: F = { name: 'Nul', barcode: null, id: 'n' };
  const list: F[] = [a, upc, custom, nul, { name: 'Other', id: 'o' }];
  const foods: F[] = [
    { name: 'Bar', barcode: EAN13, id: 'new1' }, // same product as upc
    { name: 'Renamed', barcode: OTHER, id: 'new2' },
    { name: 'Bar', barcode: '4006381333931', id: 'new3' }, // new product, same name
    { name: 'Bar', id: 'new4' }, // plain, named like scanned and custom foods
    { name: 'Nul', id: 'new5' },
    { name: 'Nothing', id: 'new6' },
    { name: 'Bar', barcode: '', id: 'new7' },
  ];
  it('returns the existing record a save replaces, or undefined', () => {
    expect(myFoodReplaced(list, foods[0] as F)).toBe(upc);
    expect(myFoodReplaced(list, foods[1] as F)).toBe(a);
    expect(myFoodReplaced(list, foods[2] as F)).toBeUndefined();
    expect(myFoodReplaced(list, foods[3] as F)).toBe(custom); // never a scanned food
    expect(myFoodReplaced(list, foods[4] as F)).toBe(nul);
    expect(myFoodReplaced(list, foods[5] as F)).toBeUndefined();
    expect(myFoodReplaced(list, foods[6] as F)).toBe(custom);
  });
  it('a plain save named like a scanned food replaces no scanned food', () => {
    expect(myFoodReplaced([a, upc], { name: 'Bar' })).toBeUndefined();
  });
  it('the record it names is exactly the one both saves drop', () => {
    for (const food of foods) {
      const replaced = myFoodReplaced(list, food);
      const expectedLeft = list.filter((x) => x !== replaced);
      expect(saveMyFood(list, food)).toEqual([food, ...expectedLeft]);
      expect(saveScannedFood(list, food)).toEqual([food, ...expectedLeft]);
    }
  });
});
