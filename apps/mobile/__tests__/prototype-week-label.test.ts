/* eslint-disable @typescript-eslint/no-require-imports */
// The test runs with apps/mobile as the working directory; node's fs is required because the app has no node typings.
const { readFileSync } = require('node:fs') as { readFileSync(p: string): Uint8Array };
/* eslint-enable @typescript-eslint/no-require-imports */

// #503: the prototype's Seven-days bar must label like WeekCard does (names the day, "not logged" on a blank day),
// so the port and its source cannot drift apart again.
const html = new TextDecoder().decode(readFileSync('../../docs/prototype/plate-and-bar.html'));
const bar = html.split('\n').find((l) => l.includes('class="bar" role="img"')) ?? '';

describe('prototype Seven-days bar label (#503)', () => {
  it('names the day', () => {
    expect(bar).toContain('aria-label="${dayName(keys[i])}');
  });
  it('says "not logged" for a day with no meals instead of announcing zeros', () => {
    expect(bar).toContain("d.meals.length ? `${fmt(t.kcal)} kcal, ${fmt(t.p)} g protein` : 'not logged'");
  });
  it('mentions a session on the day', () => {
    expect(bar).toContain("trained ? ', trained' : ''");
  });
});
