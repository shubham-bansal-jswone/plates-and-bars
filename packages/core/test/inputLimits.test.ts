import { kitchenNoteTooLong, NOTE_MAX, servingUnitTooLong, UNIT_MAX } from '../src';

describe('input length limits (contract 0.1.9, #377)', () => {
  it('serving unit: 100 characters is fine, 101 is too long, checked after trimming', () => {
    expect(UNIT_MAX).toBe(100);
    expect(servingUnitTooLong('u'.repeat(100))).toBe(false);
    expect(servingUnitTooLong('u'.repeat(101))).toBe(true);
    expect(servingUnitTooLong(`  ${'u'.repeat(100)}  `)).toBe(false);
    expect(servingUnitTooLong('')).toBe(false);
  });
  it('kitchen note: 2000 characters is fine, 2001 is too long, none is fine', () => {
    expect(NOTE_MAX).toBe(2000);
    expect(kitchenNoteTooLong('n'.repeat(2000))).toBe(false);
    expect(kitchenNoteTooLong('n'.repeat(2001))).toBe(true);
    expect(kitchenNoteTooLong('')).toBe(false);
    expect(kitchenNoteTooLong(undefined)).toBe(false);
    expect(kitchenNoteTooLong(null)).toBe(false);
  });
  it('counts UTF-16 code units: 51 emoji (51 code points, 102 units) are too long, the safe direction', () => {
    expect(servingUnitTooLong('😀'.repeat(50))).toBe(false); // 100 units
    expect(servingUnitTooLong('😀'.repeat(51))).toBe(true); // 102 units, though only 51 code points
    expect(kitchenNoteTooLong('😀'.repeat(1000))).toBe(false);
    expect(kitchenNoteTooLong('😀'.repeat(1001))).toBe(true);
  });
});
