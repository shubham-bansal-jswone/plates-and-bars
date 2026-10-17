import { addDays, checkinBannerDue, mondayOf } from '../src/index';
import { prototypeSource, sliceBlock, sliceLine } from './helpers';

/** The prototype's own `checkinBanner()`, sliced out of the HTML, against a fake `S` and `TODAY()`. */
function loadBanner(): (date: string, today: string, seen: string | null | undefined) => boolean {
  const src = prototypeSource();
  const code = [
    'const S = { date:"", settings:{} }; let today = "";',
    'const TODAY = () => today;',
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const mondayOf = '),
    sliceBlock(src, 'function checkinBanner(){', '}'),
    'return (date, t, seen) => { S.date = date; today = t; S.settings = seen === undefined ? {} : { checkinSeen: seen }; return checkinBanner() !== ""; };',
  ].join('\n');
  return new Function(code)() as ReturnType<typeof loadBanner>;
}
const proto = loadBanner();

describe('checkinBannerDue (prototype checkinBanner)', () => {
  it('matches the prototype over 6 weeks of days, with the shown day and the seen value varied', () => {
    let due = 0;
    for (let i = 0; i < 42; i++) {
      const today = addDays('2026-09-28', i); // starts on a Monday
      for (const date of [today, addDays(today, -1)]) {
        for (const seen of [null, undefined, mondayOf(today), addDays(mondayOf(today), -7), addDays(mondayOf(today), 7)]) {
          const got = checkinBannerDue({ date, today, seen });
          expect(got).toBe(proto(date, today, seen));
          if (got) due++;
        }
      }
    }
    expect(due).toBe(12 * 4); // 12 Sundays and Mondays in 6 weeks, today shown, four values that are not this week's Monday
  });

  it('is due on Sunday and Monday only, today only, and not once this week is seen', () => {
    expect(checkinBannerDue({ date: '2026-10-18', today: '2026-10-18', seen: null })).toBe(true); // Sunday
    expect(checkinBannerDue({ date: '2026-10-19', today: '2026-10-19', seen: '2026-10-12' })).toBe(true); // Monday, last week's seen
    expect(checkinBannerDue({ date: '2026-10-19', today: '2026-10-19', seen: '2026-10-19' })).toBe(false);
    expect(checkinBannerDue({ date: '2026-10-18', today: '2026-10-18', seen: '2026-10-12' })).toBe(false); // Sunday ends the week of Monday the 12th
    expect(checkinBannerDue({ date: '2026-10-20', today: '2026-10-20', seen: null })).toBe(false); // Tuesday
    expect(checkinBannerDue({ date: '2026-10-17', today: '2026-10-17', seen: null })).toBe(false); // Saturday
    expect(checkinBannerDue({ date: '2026-10-18', today: '2026-10-19', seen: null })).toBe(false); // a day that is not today
  });
});
