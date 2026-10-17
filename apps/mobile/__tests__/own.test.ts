import { ownGet, withEntry } from '../src/content/own';

describe('ownGet', () => {
  it('reads own keys only, never an inherited member or the prototype', () => {
    const all = withEntry<number>({ a: 1 }, '__proto__', 2);
    expect(ownGet(all, 'a')).toBe(1);
    expect(ownGet(all, '__proto__')).toBe(2);
    expect(ownGet({ a: 1 }, '__proto__')).toBeUndefined();
    expect(ownGet({ a: 1 }, 'constructor')).toBeUndefined();
    expect(ownGet({ a: 1 }, 'toString')).toBeUndefined();
  });
});
