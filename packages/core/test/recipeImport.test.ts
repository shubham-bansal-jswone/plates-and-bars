import { importedGrams } from '../src/index';

// Golden numbers from the prototype-final tag, `importRecipe`: String(Math.round(num(i.grams))).
describe('importedGrams', () => {
  it.each([
    [150, '150'], [149.5, '150'], [149.4, '149'], [0.4, '0'], [0.5, '1'], [2.5, '3'], [1234.6, '1235'],
    ['200', '200'], ['87,6', '88'], [-0.4, '0'], [null, '0'], [undefined, '0'], ['', '0'], ['x', '0'], [NaN, '0'],
  ])('%p -> %p', (v, out) => expect(importedGrams(v)).toBe(out));
});
