import { barcodeDigits } from '../src/barcode/digits';

describe('barcodeDigits (TODO(#944): moves to packages/core with its tests)', () => {
  it.each([
    ['EAN-13', '5000112637922'],
    ['EAN-13 (Coke)', '5449000000996'],
    ['UPC-A', '036000291452'],
    ['EAN-8', '96385074'],
    ['UPC-E', '04252614'], // expands to UPC-A 042100005264
  ])('accepts a valid %s', (_n, code) => {
    expect(barcodeDigits(code)).toBe(code);
  });

  it('ignores spaces and hyphens a pack may print', () => {
    expect(barcodeDigits(' 5000 1126-37922 ')).toBe('5000112637922');
  });

  it.each([
    ['a wrong EAN-13 check digit', '5000112637921'],
    ['a wrong UPC-A check digit', '036000291453'],
    ['a wrong EAN-8 and UPC-E check digit', '96385075'],
    ['an 8-digit number with number system 3 and a wrong EAN-8 check digit', '31234514'],
    ['too short', '1234567'],
    ['an 11-digit number', '03600029145'],
    ['a 14-digit number', '15000112637929'],
    ['letters', '50001126379ab'],
    ['empty', ''],
    ['only spaces', '   '],
  ])('rejects %s', (_n, code) => {
    expect(barcodeDigits(code)).toBeNull();
  });

  it.each([
    ['0', '01234505'],
    ['1', '01234514'],
    ['2', '01234523'],
    ['3', '01234531'],
    ['4', '01234543'],
    ['5', '01234558'],
    ['9', '01234596'],
  ])('expands a UPC-E ending in %s before checking', (_n, code) => {
    expect(barcodeDigits(code)).toBe(code);
    expect(barcodeDigits(code.slice(0, 7) + String((Number(code[7]) + 1) % 10))).toBeNull();
  });
});
