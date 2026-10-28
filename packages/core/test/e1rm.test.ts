import { E1RM_MAX_REPS, e1rm, e1rmHistory, epley, sessionElapsed, setE1rm, type E1rmSet } from '../src';

const set = (o: Partial<E1rmSet> = {}): E1rmSet => ({ date: '2026-10-01', kind: 'work', weight_kg: 80, reps: 5, done: true, rate: 'right', ...o });

describe('e1rm', () => {
  it('golden Epley values, rounded to 0.1 kg', () => {
    expect(e1rm(80, 5)).toBe(93.3);
    expect(e1rm(100, 3)).toBe(110);
    expect(e1rm(60, 10)).toBe(80);
    expect(e1rm(62.5, 8)).toBe(79.2);
    expect(e1rm(50, 12)).toBe(70);
  });
  it('one rep is the weight itself', () => expect(e1rm(142.5, 1)).toBe(142.5));
  it('no estimate above the rep cap', () => {
    expect(E1RM_MAX_REPS).toBe(12);
    expect(e1rm(50, 13)).toBeNull();
  });
  it('no estimate for blank or invalid input', () => {
    for (const [w, r] of [[null, 5], [80, null], [undefined, 5], [0, 5], [-5, 5], [80, 0], [80, 2.5], [NaN, 5], [Infinity, 5]] as const) expect(e1rm(w, r)).toBeNull();
  });
  it('no estimate when the result overflows', () => expect(e1rm(1.7e308, 5)).toBeNull());
  it('epley is unrounded and uncapped (as sessionScore)', () => expect(epley(80, 5)).toBeCloseTo(93.3333, 4));
});

describe('setE1rm', () => {
  it('counts a done work set', () => expect(setE1rm(set())).toBe(93.3));
  it('excludes ramp, undone and failed sets', () => {
    expect(setE1rm(set({ kind: 'ramp' }))).toBeNull();
    expect(setE1rm(set({ done: false }))).toBeNull();
    expect(setE1rm(set({ rate: 'fail' }))).toBeNull();
  });
  it('excludes bodyweight, timed and assisted types, keeps loaded', () => {
    expect(setE1rm(set(), 'bodyweight')).toBeNull();
    expect(setE1rm(set(), 'time')).toBeNull();
    expect(setE1rm(set(), 'assisted')).toBeNull();
    expect(setE1rm(set(), 'barbell')).toBe(93.3);
  });
});

describe('e1rmHistory', () => {
  it('takes the best per day, oldest first, skipping uncountable days', () => {
    const h = e1rmHistory([
      set({ date: '2026-10-08', weight_kg: 85, reps: 5 }),
      set({ date: '2026-10-01', weight_kg: 80, reps: 5 }),
      set({ date: '2026-10-01', weight_kg: 90, reps: 3 }),
      set({ date: '2026-10-04', rate: 'fail' }),
      set({ date: '2026-10-05', reps: 20 }),
    ]);
    expect(h).toEqual([{ date: '2026-10-01', e1rm: 99 }, { date: '2026-10-08', e1rm: 99.2 }]);
  });
  it('groups by session key when present: two sessions on one date are two points', () => {
    const h = e1rmHistory([
      set({ session: 'a', weight_kg: 80, reps: 5 }),
      set({ session: 'b', weight_kg: 90, reps: 3 }),
      set({ session: 'a', weight_kg: 60, reps: 5 }),
    ]);
    expect(h).toEqual([{ date: '2026-10-01', e1rm: 93.3 }, { date: '2026-10-01', e1rm: 99 }]);
  });
  it('is empty for no sets', () => expect(e1rmHistory([])).toEqual([]));
});

describe('sessionElapsed', () => {
  const d = (t: string | null | undefined) => ({ done: true, t });
  it('first to last tick, any order', () => {
    const r = sessionElapsed([d('2026-10-01T10:30:00Z'), d('2026-10-01T10:00:00Z'), d('2026-10-01T10:10:00Z')]);
    expect(r).toMatchObject({ seconds: 1800, from: '2026-10-01T10:00:00.000Z', to: '2026-10-01T10:30:00.000Z', complete: true, split: false });
  });
  it('spans midnight', () => expect(sessionElapsed([d('2026-10-01T23:40:00Z'), d('2026-10-02T00:20:00Z')])?.seconds).toBe(2400));
  it('skips missing, null and unparseable ticks and flags incomplete', () => {
    const r = sessionElapsed([d(null), d(undefined), d('junk'), d('2026-10-01T10:00:00Z'), d('2026-10-01T10:45:00Z')]);
    expect(r).toMatchObject({ seconds: 2700, complete: false });
  });
  it('ignores undone sets', () => {
    const r = sessionElapsed([{ done: false, t: null }, d('2026-10-01T10:00:00Z'), d('2026-10-01T10:20:00Z')]);
    expect(r).toMatchObject({ seconds: 1200, complete: true });
  });
  it('null under two usable ticks', () => {
    expect(sessionElapsed([])).toBeNull();
    expect(sessionElapsed([d('2026-10-01T10:00:00Z')])).toBeNull();
    expect(sessionElapsed([d('2026-10-01T10:00:00Z'), d(null)])).toBeNull();
  });
  it('a gap over 3 hours is cut out and flagged', () => {
    const r = sessionElapsed([d('2026-10-01T08:00:00Z'), d('2026-10-01T08:20:00Z'), d('2026-10-01T18:00:00Z'), d('2026-10-01T18:50:00Z')]);
    expect(r).toMatchObject({ seconds: 4200, from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T18:50:00.000Z', split: true });
  });
  it('null when every bout is one tick or all ticks share a second', () => {
    expect(sessionElapsed([d('2026-10-01T08:00:00Z'), d('2026-10-01T13:00:00Z')])).toBeNull();
    expect(sessionElapsed([d('2026-10-01T08:00:00Z'), d('2026-10-01T08:00:00Z')])).toBeNull();
  });
  it('accepts offsets and fractions, rejects zone-less and junk ticks', () => {
    expect(sessionElapsed([d('2026-10-01T10:00:00+01:00'), d('2026-10-01T09:30:00.500Z')])).toMatchObject({ seconds: 1800, complete: true });
    for (const bad of ['1', '2026-10-01T10:00:00', '2026-10-01', 'x2026-10-01T10:00:00Z']) {
      expect(sessionElapsed([d(bad), d('2026-10-01T10:00:00Z'), d('2026-10-01T10:10:00Z')])).toMatchObject({ seconds: 600, complete: false });
    }
  });
  it('exactly 3 hours does not split', () => expect(sessionElapsed([d('2026-10-01T08:00:00Z'), d('2026-10-01T11:00:00Z')])).toMatchObject({ seconds: 10800, split: false }));
});
