import { readFileSync } from 'fs';
import { resolve } from 'path';
import { updateLift, isPrToday, mainLifts, personalRecords, priorBestOf, PR_THRESHOLD, PR_MIN_PRIOR_SESSIONS, MAIN_LIFT_WEEKS, MAIN_LIFT_MIN_POINTS, MAIN_LIFT_COUNT, type ExType, type PrSet } from '../src/index';

type Row = [string, string, number, number, string];
interface Rec { lift: string; date: string; metric: string; score: number; set: { w: number; r: number }; previous_best: number; delta: number }
const v = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/records.json'), 'utf8')) as {
  constants: { pr_threshold: number; pr_min_prior_sessions: number; main_lift_weeks: number; main_lift_min_points: number; main_lift_count: number };
  records: { note: string; types: Record<string, ExType>; bodyweight_kg?: number; sets: Row[]; records: Rec[] }[];
  tick: { note: string; prior: { best: number; sessions: number }; sets: Row[]; type: ExType | null; bodyweight_kg?: number; result: Rec | null }[];
  main_lifts: { note: string; end: string; types: Record<string, ExType>; sets: Row[]; lifts: { lift: string; sessions: number; last: string }[] }[];
};
const mk = (rows: Row[]): PrSet[] =>
  rows.map(([exercise, date, w, r, flag]) => ({ exercise, date, kind: flag === 'ramp' ? 'ramp' : 'work', weight_kg: w, reps: r, done: flag !== 'undone', rate: flag === 'fail' ? 'fail' : null, deleted_at: flag === 'deleted' ? '2026-12-01T00:00:00Z' : null }));
const wire = (r: Rec) => ({ lift: r.lift, date: r.date, metric: r.metric, score: r.score, set: r.set, previousBest: r.previous_best, delta: r.delta });
const wireImp = (r: Rec | null) => (r ? { metric: r.metric, score: r.score, set: r.set, previousBest: r.previous_best, delta: r.delta } : null);

describe('personal records (#1351 C3)', () => {
  it('constants match the vectors', () => {
    expect([PR_THRESHOLD, PR_MIN_PRIOR_SESSIONS, MAIN_LIFT_WEEKS, MAIN_LIFT_MIN_POINTS, MAIN_LIFT_COUNT]).toEqual([
      v.constants.pr_threshold, v.constants.pr_min_prior_sessions, v.constants.main_lift_weeks, v.constants.main_lift_min_points, v.constants.main_lift_count,
    ]);
  });
  it.each(v.records.map((c) => [c.note, c] as const))('personalRecords: %s', (_n, c) => {
    expect(personalRecords(mk(c.sets), c.types, c.bodyweight_kg)).toEqual(c.records.map(wire));
  });
  it.each(v.tick.map((c) => [c.note, c] as const))('isPrToday: %s', (_n, c) => {
    expect(isPrToday(c.prior, mk(c.sets), c.type ?? undefined, c.bodyweight_kg)).toEqual(wireImp(c.result));
  });
  it.each(v.main_lifts.map((c) => [c.note, c] as const))('mainLifts: %s', (_n, c) => {
    expect(mainLifts(mk(c.sets), c.types, c.end)).toEqual(c.lifts);
  });

  describe('toast and list agree', () => {
    it('every record is what isPrToday says on that day against priorBestOf', () => {
      for (const c of v.records) {
        const sets = mk(c.sets);
        for (const r of personalRecords(sets, c.types)) {
          const mine = sets.filter((s) => s.exercise === r.lift);
          const bw = c.bodyweight_kg;
          const hit = isPrToday(priorBestOf(mine, c.types[r.lift], r.date, bw), mine.filter((s) => s.date === r.date), c.types[r.lift], bw);
          expect(hit).toEqual({ metric: r.metric, score: r.score, set: r.set, previousBest: r.previousBest, delta: r.delta });
        }
      }
    });
  });

  describe('priorBestOf', () => {
    const sets = mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-01', 90, 5, ''], ['B', '2026-03-05', 120, 5, 'fail'], ['B', '2026-03-06', 130, 5, 'deleted'], ['B', '2026-03-10', 105, 5, '']]);
    it('all-time best and distinct earlier days, only before the date', () => {
      expect(priorBestOf(sets, undefined, '2026-03-10')).toEqual({ best: 116.7, sessions: 1 });
      expect(priorBestOf(sets, undefined, '2026-03-11')).toEqual({ best: 122.5, sessions: 2 });
    });
    it('nothing before: zero', () => expect(priorBestOf(sets, undefined, '2026-03-01')).toEqual({ best: 0, sessions: 0 }));
    it('bodyweight scores total reps (fail counts, deleted does not)', () => expect(priorBestOf(sets, 'bodyweight', '2026-03-11')).toEqual({ best: 10, sessions: 3 }));
  });

  describe('assisted and zero sets', () => {
    it('earlier days are rescored at the bodyweight passed in', () => {
      const s = mk([['D', '2026-03-01', 30, 10, ''], ['D', '2026-03-08', 30, 10, '']]);
      expect(priorBestOf(s.slice(0, 1), 'assisted', '2026-03-08', 80)).toEqual({ best: 500, sessions: 1 });
      expect(isPrToday(priorBestOf(s, 'assisted', '2026-03-08', 80), s.slice(1), 'assisted', 80)).toBeNull();
    });
    it('difference (e): updateLift toasts on a weigh-in alone, isPrToday does not', () => {
      const ex = { sets: [{ w: '30', r: '10', done: true }] };
      const day1 = updateLift(null, ex, '2026-03-01', 'assisted', 75);
      const day2 = updateLift(day1?.record, ex, '2026-03-08', 'assisted', 80);
      expect(day2?.toast).toBe(true);
      expect(day2?.record?.hist?.map((h) => h.e)).toEqual([450, 500]);
      const s = mk([['D', '2026-03-01', 30, 10, ''], ['D', '2026-03-08', 30, 10, '']]);
      expect(isPrToday(priorBestOf(s, 'assisted', '2026-03-08', 80), s.slice(1), 'assisted', 80)).toBeNull();
    });
    it('a day of only 0/0 sets is not a session', () => {
      expect(priorBestOf(mk([['P', '2026-03-01', 0, 0, '']]), 'bodyweight', '2026-03-10')).toEqual({ best: 0, sessions: 0 });
    });
  });

  describe('edge cases', () => {
    it('empty input', () => {
      expect(personalRecords([], {})).toEqual([]);
      expect(mainLifts([], {}, '2026-10-29')).toEqual([]);
      expect(isPrToday({ best: 100, sessions: 2 }, [])).toBeNull();
    });
    it('a day with no countable set neither records nor counts as a session', () => {
      const s = mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-05', 200, 5, 'fail'], ['B', '2026-03-10', 105, 5, '']]);
      expect(personalRecords(s, {}).map((r) => r.date)).toEqual(['2026-03-10']);
    });
    it('same-day estimate tie keeps the heavier set', () => {
      // 90x10 = 120 exactly, 120x1 = 120
      const s = mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 90, 10, ''], ['B', '2026-03-10', 120, 1, '']]);
      expect(personalRecords(s, {})[0]?.set).toEqual({ w: 120, r: 1 });
      const s2 = mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 120, 1, ''], ['B', '2026-03-10', 90, 10, '']]);
      expect(personalRecords(s2, {})[0]?.set).toEqual({ w: 120, r: 1 });
      // identical sets
      const s3 = mk([['B', '2026-03-01', 50, 5, ''], ['B', '2026-03-10', 100, 1, ''], ['B', '2026-03-10', 100, 1, '']]);
      expect(personalRecords(s3, {})[0]?.set).toEqual({ w: 100, r: 1 });
    });
    it('records on the same date sort by lift name', () => {
      const s = mk([['Z', '2026-03-01', 50, 5, ''], ['A', '2026-03-01', 50, 5, ''], ['Z', '2026-03-10', 100, 5, ''], ['A', '2026-03-10', 100, 5, '']]);
      expect(personalRecords(s, {}).map((r) => r.lift)).toEqual(['A', 'Z']);
    });
    it('bodyweight and assisted ties keep the heavier set; an empty or zero day is skipped', () => {
      const bw = mk([['P', '2026-03-01', 0, 5, ''], ['P', '2026-03-10', 0, 5, ''], ['P', '2026-03-10', 10, 5, ''], ['P', '2026-03-10', 5, 5, ''], ['P', '2026-03-10', 0, 0, ''], ['P', '2026-03-10', 0, 20, 'undone']]);
      expect(personalRecords(bw, { P: 'bodyweight' }).map((r) => [r.score, r.set])).toEqual([[15, { w: 10, r: 5 }]]);
      const s = mk([['P', '2026-03-01', 0, 5, ''], ['P', '2026-03-10', 0, 5, ''], ['P', '2026-03-10', 10, 5, ''], ['P', '2026-03-10', 5, 8, '']]);
      expect(personalRecords(s, { P: 'bodyweight' })[0]?.set).toEqual({ w: 5, r: 8 });
      const t = mk([['P', '2026-03-10', 10, 5, ''], ['P', '2026-03-10', 0, 5, '']]);
      expect(isPrToday({ best: 1, sessions: 1 }, t, 'bodyweight')?.set).toEqual({ w: 10, r: 5 });
      expect(isPrToday({ best: 1, sessions: 1 }, mk([['P', '2026-03-10', 0, 0, '']]), 'bodyweight')).toBeNull();
      expect(isPrToday({ best: 1, sessions: 1 }, mk([['P', '2026-03-10', 0, 5, '']]))).toBeNull();
    });
    it('two sessions on one day are one day for records', () => {
      const s: PrSet[] = [...mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 105, 5, ''], ['B', '2026-03-10', 106, 5, '']])];
      expect(personalRecords(s, {})).toHaveLength(1);
    });
    it('mainLifts counts days: two sessions on one date are one point', () => {
      const s: PrSet[] = [...mk([['B', '2026-10-01', 100, 5, ''], ['B', '2026-10-01', 100, 5, ''], ['B', '2026-10-02', 100, 5, '']])].map((x, i) => ({ ...x, session: 's' + i }));
      expect(mainLifts(s, {}, '2026-10-29')).toEqual([]);
    });
    it('mainLifts ends at the viewed date', () => {
      const s = mk(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].map((d): Row => ['B', d, 100, 5, '']));
      expect(mainLifts(s, {}, '2026-10-14')).toEqual([]);
      expect(mainLifts(s, {}, '2026-10-15')).toHaveLength(1);
    });
    it('mainLifts ties fall back to the name', () => {
      const d = ['2026-10-01', '2026-10-08', '2026-10-15'];
      const s = mk([...d.map((x): Row => ['B', x, 100, 5, '']), ...d.map((x): Row => ['A', x, 100, 5, ''])]);
      expect(mainLifts(s, {}, '2026-10-29').map((m) => m.lift)).toEqual(['A', 'B']);
    });
    it('a type missing from the map is treated as loaded', () => {
      expect(personalRecords(mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 105, 5, '']]), {})).toHaveLength(1);
    });
  });
});
