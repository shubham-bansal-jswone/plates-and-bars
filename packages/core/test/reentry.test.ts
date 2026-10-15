import { addDays, reentryCard, reentryRange, steadyCard, type AdjState, type SessionLog } from '../src/index';
import { rng } from './prototype-plan';
import { loadReentry } from './prototype-reentry';

// No golden fixture covers these cards; they are checked by hand-worked unit tests and against the
// prototype's own renderStart() steps (differential tests below).
const DATE = '2026-10-07'; // a Wednesday; its Monday is 2026-10-05
const log = (...ds: string[]): Record<string, { t: string; n: number }> => Object.fromEntries(ds.map((d) => [d, { t: 'Push A', n: 5 }]));
/** 3 sessions (Mon, Wed, Fri) in each of the `weeks` weeks before 2026-10-05. */
const steady = (weeks: number): Record<string, { t: string; n: number }> =>
  log(...Array.from({ length: weeks }, (_, k) => addDays('2026-10-05', -7 * (k + 1))).flatMap((m) => [m, addDays(m, 2), addDays(m, 4)]));

describe('reentryCard', () => {
  it('shows at 14 days or more; 28 days or more is the long version', () => {
    expect(reentryCard({}, DATE)).toBeNull();
    expect(reentryCard(log('2026-09-24'), DATE)).toBeNull();
    expect(reentryCard(log('2026-09-23'), DATE)).toEqual({ key: 'break:2026-09-23', gap: 14, long: false, pct: 0.15 });
    expect(reentryCard(log('2026-09-10'), DATE)).toEqual({ key: 'break:2026-09-10', gap: 27, long: false, pct: 0.15 });
    expect(reentryCard(log('2026-08-01', '2026-09-09'), DATE)).toEqual({ key: 'break:2026-09-09', gap: 28, long: true, pct: 0.3 });
  });
  it('counts only earlier dates with a logged set', () => {
    const s: SessionLog = { ...log('2026-09-01'), '2026-10-01': { t: 'Pull A', n: 0 }, '2026-10-02': { t: 'Pull A' }, [DATE]: { t: 'Legs A', n: 4 } };
    expect(reentryCard(s, DATE)).toMatchObject({ key: 'break:2026-09-01', gap: 36 });
  });
  it('hidden while a re-entry period runs, when muted or dismissed', () => {
    const s = log('2026-09-01');
    expect(reentryCard(s, DATE, { reentry: { from: '2026-10-01', until: DATE } })).toBeNull();
    expect(reentryCard(s, DATE, { reentry: { from: '2026-09-20', until: '2026-10-06' } })).not.toBeNull();
    expect(reentryCard(s, DATE, { muted: { break: true } })).toBeNull();
    expect(reentryCard(s, DATE, { dismissed: { 'break:2026-09-01': true } })).toBeNull();
    expect(reentryCard(s, DATE, { muted: { deload: true }, dismissed: { 'break:2026-08-01': true } })).not.toBeNull();
  });
});

describe('reentryRange', () => {
  it('7 days at 15%, 14 days at 30%', () => {
    expect(reentryRange(DATE, 0.15)).toEqual({ from: DATE, until: '2026-10-13', pct: 0.15 });
    expect(reentryRange(DATE, 0.3)).toEqual({ from: DATE, until: '2026-10-20', pct: 0.3 });
  });
});

describe('steadyCard', () => {
  it('6 or more full weeks in a row with 3 sessions, counting up to 10', () => {
    expect(steadyCard(steady(5), DATE)).toBeNull();
    expect(steadyCard(steady(6), DATE)).toEqual({ key: 'dlplan:2026-10-05', weeks: 6 });
    expect(steadyCard(steady(12), DATE)).toEqual({ key: 'dlplan:2026-10-05', weeks: 10 });
  });
  it('a short last week breaks the run; this week does not count; empty entries do', () => {
    const s = steady(8);
    delete s['2026-10-02'];
    expect(steadyCard(s, DATE)).toBeNull();
    expect(steadyCard({ ...steady(5), ...log('2026-10-05', '2026-10-06', DATE) }, DATE)).toBeNull();
    expect(steadyCard({ ...steady(5), '2026-08-24': {}, '2026-08-25': { n: 0 }, '2026-08-26': { t: 'Push A', n: 0 } }, DATE)).toMatchObject({ weeks: 6 });
  });
  it('hidden within 42 days of a recovery week, during one, when muted or dismissed', () => {
    const s = steady(6);
    expect(steadyCard(s, DATE, { deload: { from: '2026-08-20', until: '2026-08-26' } })).toBeNull();
    expect(steadyCard(s, DATE, { deload: { from: '2026-08-19', until: '2026-08-25' } })).not.toBeNull();
    expect(steadyCard(s, DATE, { deload: { from: '2026-10-10', until: '2026-10-16' } })).toBeNull();
    expect(steadyCard(s, DATE, { muted: { 'deload-plan': true } })).toBeNull();
    expect(steadyCard(s, DATE, { dismissed: { 'dlplan:2026-10-05': true } })).toBeNull();
    expect(steadyCard(s, '2026-10-12', { dismissed: { 'dlplan:2026-10-05': true } })).toBeNull(); // week of 10-05 has no sessions
  });
});

describe('re-entry and steady-weeks cards: differential against the prototype', () => {
  const proto = loadReentry();
  const r = rng(486);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const dates = ['2026-09-30', '2026-10-05', DATE, '2026-10-11', '2026-10-12', '2026-11-02'];
  const randSessions = (): SessionLog => {
    const out: Record<string, { t?: string; n?: number }> = {};
    const dense = r() < 0.5;
    for (let d = '2026-06-01'; d <= '2026-11-05'; d = addDays(d, 1)) {
      if (r() < (dense ? 0.6 : 0.08)) out[d] = pick([{ t: 'Push A', n: 5 }, { t: 'Pull A', n: 0 }, { t: 'Legs A' }, { n: 2 }]);
    }
    if (r() < 0.4) for (const d of Object.keys(out)) if (d > pick(['2026-08-01', '2026-09-01', '2026-09-15', '2026-09-25'])) delete out[d];
    return out;
  };
  const randAdj = (date: string, last: string | undefined): AdjState => ({
    muted: { break: r() < 0.1, 'deload-plan': r() < 0.1 },
    dismissed: r() < 0.15 ? { [`break:${last}`]: true, [`dlplan:${pick(['2026-10-05', '2026-09-28'])}`]: true } : {},
    ...(r() < 0.3 ? { deload: pick([{ from: date, until: addDays(date, 6) }, { until: '2026-08-20' }, { from: '2026-08-01', until: addDays(date, -43) }, { from: addDays(date, 3), until: addDays(date, 9) }]) } : {}),
    ...(r() < 0.3 ? { reentry: pick([{ from: date, until: addDays(date, 6) }, { until: '2026-08-20' }, { from: addDays(date, 1), until: addDays(date, 9) }]) } : {}),
  });

  it('cards and "Ease back in" match on 3,000 random states', () => {
    let breaks = 0;
    let steadies = 0;
    for (let k = 0; k < 3000; k++) {
      const date = pick(dates);
      const sessions = randSessions();
      const last = Object.keys(sessions).filter((d) => d < date && (sessions[d]?.n ?? 0) > 0).sort().pop();
      const adj = randAdj(date, last);
      Object.assign(proto.S, { date, sessions: { entries: clone(sessions) }, settings: { adj: clone(adj) } });

      const st = steadyCard(sessions, date, adj);
      const sh = proto.steadyCard();
      if (!st) expect(sh).toBe('');
      else {
        steadies++;
        expect(sh).toContain(`data-key="${st.key}"`);
        expect(sh).toContain(`<b>${st.weeks} steady weeks of training</b>`);
      }

      const card = reentryCard(sessions, date, adj);
      const html = proto.reentryCard();
      if (!card) expect(html).toBe('');
      else {
        breaks++;
        expect(html).toContain(`data-key="${card.key}"`);
        expect(html).toContain(`It’s been ${card.gap} days.`);
        expect(html).toContain(card.long ? 'For the next 2 weeks' : 'For this week');
        expect(html).toContain(`data-act="adj-reentry" data-v="${card.pct}" data-type="break"`);
        proto.adjAction('adj-reentry', { dataset: { type: 'break', key: card.key, v: String(card.pct) } });
        expect((proto.S.settings.adj as AdjState).reentry).toEqual(reentryRange(date, card.pct));
      }
    }
    expect(breaks).toBeGreaterThan(100);
    expect(steadies).toBeGreaterThan(100);
  });
});
