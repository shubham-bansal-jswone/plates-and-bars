import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isPrToday, mainLifts, personalRecords, priorBestOf, PR_THRESHOLD, PR_MIN_PRIOR_SESSIONS, MAIN_LIFT_WEEKS, MAIN_LIFT_MIN_POINTS, MAIN_LIFT_COUNT, type ExType, type PrSet } from '../src/index';

type Row = [string, string, number, number, string];
interface Rec { lift: string; date: string; e1rm: number; set: { w: number; r: number }; previous_best: number; delta: number }
const v = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/spec/golden/records.json'), 'utf8')) as {
  constants: { pr_threshold: number; pr_min_prior_sessions: number; main_lift_weeks: number; main_lift_min_points: number; main_lift_count: number };
  records: { note: string; types: Record<string, ExType>; sets: Row[]; records: Rec[] }[];
  tick: { note: string; prior: { best: number; sessions: number }; sets: Row[]; type: ExType | null; result: Rec | null }[];
  main_lifts: { note: string; today: string; types: Record<string, ExType>; sets: Row[]; lifts: { lift: string; sessions: number; last: string }[] }[];
};
const mk = (rows: Row[]): PrSet[] =>
  rows.map(([exercise, date, w, r, flag]) => ({ exercise, date, kind: flag === 'ramp' ? 'ramp' : 'work', weight_kg: w, reps: r, done: flag !== 'undone', rate: flag === 'fail' ? 'fail' : null, deleted_at: flag === 'deleted' ? '2026-12-01T00:00:00Z' : null }));
const wire = (r: Rec) => ({ lift: r.lift, date: r.date, e1rm: r.e1rm, set: r.set, previousBest: r.previous_best, delta: r.delta });
const wireImp = (r: Rec | null) => (r ? { e1rm: r.e1rm, set: r.set, previousBest: r.previous_best, delta: r.delta } : null);

describe('personal records (#1351 C3)', () => {
  it('constants match the vectors', () => {
    expect([PR_THRESHOLD, PR_MIN_PRIOR_SESSIONS, MAIN_LIFT_WEEKS, MAIN_LIFT_MIN_POINTS, MAIN_LIFT_COUNT]).toEqual([
      v.constants.pr_threshold, v.constants.pr_min_prior_sessions, v.constants.main_lift_weeks, v.constants.main_lift_min_points, v.constants.main_lift_count,
    ]);
  });
  it.each(v.records.map((c) => [c.note, c] as const))('personalRecords: %s', (_n, c) => {
    expect(personalRecords(mk(c.sets), c.types)).toEqual(c.records.map(wire));
  });
  it.each(v.tick.map((c) => [c.note, c] as const))('isPrToday: %s', (_n, c) => {
    expect(isPrToday(c.prior, mk(c.sets), c.type ?? undefined)).toEqual(wireImp(c.result));
  });
  it.each(v.main_lifts.map((c) => [c.note, c] as const))('mainLifts: %s', (_n, c) => {
    expect(mainLifts(mk(c.sets), c.types, c.today)).toEqual(c.lifts);
  });

  describe('toast and list agree', () => {
    it('every record is what isPrToday says on that day against priorBestOf', () => {
      for (const c of v.records) {
        const sets = mk(c.sets);
        for (const r of personalRecords(sets, c.types)) {
          const mine = sets.filter((s) => s.exercise === r.lift);
          const hit = isPrToday(priorBestOf(mine, c.types[r.lift], r.date), mine.filter((s) => s.date === r.date), c.types[r.lift]);
          expect(hit).toEqual({ e1rm: r.e1rm, set: r.set, previousBest: r.previousBest, delta: r.delta });
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
    it('excluded types give nothing', () => expect(priorBestOf(sets, 'bodyweight', '2026-03-11')).toEqual({ best: 0, sessions: 0 }));
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
    it('same-day estimate tie keeps the heavier set, then the lower reps', () => {
      // 90x10 = 120 exactly, 120x1 = 120
      const s = mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 90, 10, ''], ['B', '2026-03-10', 120, 1, '']]);
      expect(personalRecords(s, {})[0]?.set).toEqual({ w: 120, r: 1 });
      const s2 = mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 120, 1, ''], ['B', '2026-03-10', 90, 10, '']]);
      expect(personalRecords(s2, {})[0]?.set).toEqual({ w: 120, r: 1 });
      // same weight and estimate cannot differ in reps; 100x1 vs 100x1 duplicate
      const s3 = mk([['B', '2026-03-01', 50, 5, ''], ['B', '2026-03-10', 100, 1, ''], ['B', '2026-03-10', 100, 1, '']]);
      expect(personalRecords(s3, {})[0]?.set).toEqual({ w: 100, r: 1 });
    });
    it('records on the same date sort by lift name', () => {
      const s = mk([['Z', '2026-03-01', 50, 5, ''], ['A', '2026-03-01', 50, 5, ''], ['Z', '2026-03-10', 100, 5, ''], ['A', '2026-03-10', 100, 5, '']]);
      expect(personalRecords(s, {}).map((r) => r.lift)).toEqual(['A', 'Z']);
    });
    it('two sessions on one day are one day for records', () => {
      const s: PrSet[] = [...mk([['B', '2026-03-01', 100, 5, ''], ['B', '2026-03-10', 105, 5, ''], ['B', '2026-03-10', 106, 5, '']])];
      expect(personalRecords(s, {})).toHaveLength(1);
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
