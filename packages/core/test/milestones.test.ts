import content from '../../../content/exercises.json';
import { BENCH_LIFTS, EZ_BAR_LIFTS, SQUAT_LIFTS, PLATE_MILESTONES, milestones, addDays, type ExType, type Milestone, type PrSet, type SessionLog, type WeightUnit } from '../src/index';
import { loadGolden } from './helpers';

type Row = [string, string, number, number, string];
interface Run { start: string; count: number; step_days: number; n: number }
interface Case {
  note: string;
  unit: WeightUnit;
  end: string;
  types: Record<string, ExType>;
  weights: [string, number][];
  profile: { days?: number; weight_kg?: number } | null;
  sets: Row[];
  sessions: Run[];
  milestones: Milestone[];
}
const g = loadGolden<{ cases: Case[] }>('milestones');

const mkSets = (rows: Row[]): PrSet[] =>
  rows.map(([exercise, date, w, r, flag]) => ({ exercise, date, kind: flag === 'ramp' ? 'ramp' : 'work', weight_kg: w, reps: r, done: flag !== 'undone', rate: flag === 'fail' ? 'fail' : null, deleted_at: flag === 'deleted' ? '2026-12-01T00:00:00Z' : null }));
const mkSessions = (runs: Run[]): SessionLog => {
  const log: Record<string, { n: number }> = {};
  for (const r of runs) for (let i = 0; i < r.count; i++) log[addDays(r.start, i * r.step_days)] = { n: r.n };
  return log;
};

describe('milestones (#1351 C6)', () => {
  it.each(g.cases.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const out = milestones(mkSets(c.sets), mkSessions(c.sessions), c.weights.map(([date, weight_kg]) => ({ date, weight_kg })), c.types, c.unit, c.end, c.profile);
    expect(out).toEqual(c.milestones);
  });

  it('every milestone has a stable id, kind, title and detail', () => {
    const out = milestones(mkSets([['Barbell Back Squat', '2026-01-05', 62.5, 5, '']]), {}, [], { 'Barbell Back Squat': 'barbell' }, 'kg', '2026-02-01');
    expect(out).toEqual([{ id: 'plates-1', kind: 'plates', title: 'One plate a side', detail: 'Barbell Back Squat, 62.5 kg', date: '2026-01-05' }]);
  });

  it('words weights in the user unit and orders the counts', () => {
    const out = milestones(mkSets([['Barbell Back Squat', '2026-01-05', 140, 5, '']]), {}, [], { 'Barbell Back Squat': 'barbell' }, 'lb', '2026-02-01');
    expect(out.map((m) => [m.id, m.title, m.detail])).toEqual([
      ['plates-1', 'One plate a side', 'Barbell Back Squat, 308.6 lb'],
      ['plates-2', 'Two plates a side', 'Barbell Back Squat, 308.6 lb'],
      ['plates-3', 'Three plates a side', 'Barbell Back Squat, 308.6 lb'],
    ]);
    const w = milestones([], mkSessions([{ start: '2026-01-01', count: 100, step_days: 1, n: 1 }]), [], {}, 'kg', '2026-12-31', { days: 0 });
    expect(w.map((m) => [m.title, m.detail])).toEqual([['100th workout', '100 workouts completed'], ['50th workout', '50 workouts completed'], ['10th workout', '10 workouts completed']]);
    const b = milestones(mkSets([['Barbell Bench Press', '2026-01-05', 80, 1, '']]), {}, [{ date: '2026-01-01', weight_kg: 80 }], {}, 'kg', '2026-02-01');
    expect(b).toEqual([{ id: 'bench-bodyweight', kind: 'bodyweight', title: 'Bench press at your bodyweight', detail: 'Barbell Bench Press, 80 kg', date: '2026-01-05' }]);
  });

  it('ignores deleted weigh-ins and is not order dependent', () => {
    const sets = mkSets([['Barbell Bench Press', '2026-01-05', 80, 1, ''], ['Barbell Bench Press', '2026-01-02', 80, 1, '']]);
    const w = [{ date: '2026-01-01', weight_kg: 80, deleted_at: '2026-01-03T00:00:00Z' }, { date: '2026-01-01', weight_kg: 90 }];
    expect(milestones(sets, {}, w, {}, 'kg', '2026-02-01')).toEqual([]);
    const a = milestones(sets, {}, [], {}, 'kg', '2026-02-01', { weight_kg: 80 });
    const b = milestones([...sets].reverse(), {}, [], {}, 'kg', '2026-02-01', { weight_kg: 80 });
    expect(a).toEqual(b);
    expect(a[0]?.date).toBe('2026-01-02');
  });

  it('is derived: deleting the source set removes the milestone', () => {
    const sets = mkSets([['Barbell Back Squat', '2026-01-05', 60, 5, '']]);
    const types = { 'Barbell Back Squat': 'barbell' as const };
    expect(milestones(sets, {}, [], types, 'kg', '2026-02-01')).toHaveLength(1);
    expect(milestones(sets.map((s) => ({ ...s, deleted_at: 'x' })), {}, [], types, 'kg', '2026-02-01')).toHaveLength(0);
  });

  it('switching unit never changes ids or dates', () => {
    const sets = mkSets([['Barbell Back Squat', '2026-01-05', 60, 5, ''], ['Barbell Back Squat', '2026-01-12', 100, 3, ''], ['Barbell Back Squat', '2026-01-19', 140, 1, ''], ['Barbell Bench Press', '2026-01-20', 61.2, 1, '']]);
    const run = (unit: WeightUnit) => milestones(sets, {}, [], { 'Barbell Back Squat': 'barbell', 'Barbell Bench Press': 'barbell' }, unit, '2026-02-01').map((m) => [m.id, m.date]);
    expect(run('lb')).toEqual(run('kg'));
    expect(run('kg')).toHaveLength(3);
  });

  it('the plate steps and the named lifts match the spec and the content', () => {
    for (const n of EZ_BAR_LIFTS) expect((content as { meta: Record<string, { type: string }> }).meta[n]?.type).toBe('barbell');
    expect(PLATE_MILESTONES).toEqual({ kg: [60, 100, 140], lb: [135, 225, 315] });
    const meta = (content as { meta: Record<string, { type: string }> }).meta;
    for (const n of [...BENCH_LIFTS, ...SQUAT_LIFTS]) {
      expect(meta[n]).toBeDefined();
      expect(meta[n]?.type).toBe('barbell');
    }
  });
});
