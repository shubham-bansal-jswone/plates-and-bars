import { isBlank } from '../src/text/blank';

// The contract's vectors (#510), read directly so they cannot drift.
const vectors = require('../../../packages/api/test-vectors/blank-text.json') as { pattern: string; must_fail: string[]; must_pass: string[] };
describe('isBlank (#421)', () => {
  it.each(vectors.must_fail.map((t) => [JSON.stringify(t), t]))('is blank: %s', (_n, t) => expect(isBlank(t)).toBe(true));
  it.each(vectors.must_pass.map((t) => [JSON.stringify(t), t]))('is not blank: %s', (_n, t) => expect(isBlank(t)).toBe(false));
  it('matches the contract pattern on every vector', () => {
    const re = new RegExp(vectors.pattern);
    for (const t of [...vectors.must_fail, ...vectors.must_pass]) expect(re.test(t)).toBe(!isBlank(t));
  });
});
