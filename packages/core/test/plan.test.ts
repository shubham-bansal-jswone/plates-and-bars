import {
  dayTemplate,
  daysBetween,
  exerciseCap,
  mondayOf,
  planned,
  planList,
  splitFor,
  SPLITS,
  TEMPLATES,
  type PlanProfile,
  type PlanState,
  type SessionLog,
} from '../src/index';
import { loadGolden } from './helpers';
import { loadProto, rng } from './prototype-plan';

interface GoldenPlan {
  templates: Record<string, string[]>;
  splits: Record<string, { list: string[]; days: number[] }>;
  plans: {
    days: number;
    week: { date: string; template: string | null }[];
    exerciseCapByMinutes: { minutes: number; cap: number }[];
  }[];
}

const golden = loadGolden<GoldenPlan>('plan');
const state = (profile: PlanProfile | null, sessions: SessionLog = {}): PlanState => ({ profile, sessions });

describe('plan: golden/plan.json', () => {
  it('has the templates and splits', () => {
    expect(TEMPLATES).toEqual(golden.templates);
    expect(JSON.parse(JSON.stringify(SPLITS))).toEqual(golden.splits);
  });

  it('covers 2, 3, 4, 5 and 6 days', () => {
    expect(golden.plans.map((p) => p.days)).toEqual([2, 3, 4, 5, 6]);
  });

  describe.each(golden.plans.map((p) => [p.days, p] as const))('%i days', (days, p) => {
    it.each(p.week.map((d) => [d.date, d.template] as const))('planned(%s) = %p', (date, template) => {
      expect(planned(date, state({ days }))).toBe(template);
    });

    it.each(p.exerciseCapByMinutes.map((c) => [c.minutes, c.cap] as const))('exerciseCap(%i min) = %i', (minutes, cap) => {
      expect(exerciseCap({ days, minutes })).toBe(cap);
    });
  });
});

describe('plan: edge cases', () => {
  const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

  it('0 days means no plan: every day is null, even in sequence mode', () => {
    expect(week.map((d) => planned(d, state({ days: 0 })))).toEqual(week.map(() => null));
    expect(planned('2026-10-05', { ...state({ days: 0 }), mode: 'sequence' })).toBeNull();
    expect(planList({ days: 0 })).toEqual([]);
  });

  it('clamps 1 day to the 2-day split and 7 days to the 6-day split (Sunday stays rest)', () => {
    expect(splitFor({ days: 1 })).toBe(SPLITS[2]);
    expect(splitFor({ days: 7 })).toBe(SPLITS[6]);
    expect(planned('2026-10-11', state({ days: 7 }))).toBeNull();
  });

  // Prototype quirk, pinned on purpose: a profile whose `days` is missing or null gets the full
  // 6-day plan (`p.days ? … : 6`), while calcTargets counts the same null as 0 training days.
  it('PINNED QUIRK: missing or null days gives the 6-day plan', () => {
    expect(splitFor(null)).toBe(SPLITS[6]);
    expect(splitFor({})).toBe(SPLITS[6]);
    expect(splitFor({ days: null })).toBe(SPLITS[6]);
    expect(dayTemplate('2026-10-05', { days: null })).toBe('Push A');
  });

  it('defaults session length to 60 minutes (5 exercises)', () => {
    expect(exerciseCap(null)).toBe(5);
    expect(exerciseCap({ minutes: null })).toBe(5);
    expect(exerciseCap({ minutes: 20 })).toBe(3);
    expect(exerciseCap({ minutes: 120 })).toBe(7);
  });

  it('sequence mode follows the last logged session, skipping empty ones', () => {
    const sessions = { '2026-10-05': { t: 'Upper A', n: 12 }, '2026-10-06': { t: 'Lower A', n: 0 } };
    const s: PlanState = { ...state({ days: 4 }, sessions), mode: 'sequence' };
    expect(planned('2026-10-07', s)).toBe('Lower A');
    expect(planned('2026-10-05', s)).toBe('Upper A');
    expect(planned('2026-10-07', { ...s, sessions: { '2026-10-06': { t: 'Lower B', n: 3 } } })).toBe('Upper A');
    expect(planned('2026-10-11', s)).toBeNull();
  });

  it('a week plan for this week wins, even on Sunday, and ends when its list runs out', () => {
    const weekPlan = { start: '2026-10-05', list: ['Legs A', 'Push A'] };
    const s: PlanState = { ...state({ days: 3 }, { '2026-10-05': { t: 'Legs A', n: 10 }, '2026-10-04': { t: 'Pull A', n: 9 } }), weekPlan };
    expect(planned('2026-10-05', s)).toBe('Legs A');
    expect(planned('2026-10-06', s)).toBe('Push A');
    expect(planned('2026-10-11', s)).toBe('Push A');
    expect(planned('2026-10-08', { ...s, sessions: { ...s.sessions, '2026-10-07': { t: 'Push A', n: 4 } } })).toBeNull();
    expect(planned('2026-10-12', s)).toBe('Full body A');
  });
});

describe('dates', () => {
  it('mondayOf and daysBetween', () => {
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
    expect(mondayOf('2026-10-05')).toBe('2026-10-05');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7);
  });
});

describe('planned: differential against the prototype source', () => {
  const proto = loadProto();
  const r = rng(19);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const days: (number | null | undefined)[] = [undefined, null, 0, 1, 2, 3, 4, 5, 6, 7];
  const start = '2026-09-28';
  const dates = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10));
  const tpls = [...Object.keys(TEMPLATES), 'Gone'];

  it('matches on 3,000 random states', () => {
    const mismatches: unknown[] = [];
    for (let k = 0; k < 3000; k++) {
      const d = pick(days);
      const profile: PlanProfile | null = d === undefined && r() < 0.5 ? null : d === undefined ? {} : { days: d };
      const sessions: Record<string, { t?: string; n?: number }> = {};
      for (const date of dates) if (r() < 0.3) sessions[date] = { t: pick(tpls), n: pick([0, 3, 12]) };
      const s: PlanState = { profile, sessions };
      if (r() < 0.3) s.mode = 'sequence';
      if (r() < 0.3) s.weekPlan = { start: pick([start, '2026-10-05', '2026-10-12']), list: [pick(tpls), pick(tpls), pick(tpls)] };
      Object.assign(proto.S, { date: start, settings: { profile, adj: { mode: s.mode, weekPlan: s.weekPlan } }, sessions: { entries: sessions } });
      for (const date of dates) {
        const ours = planned(date, s);
        const theirs = proto.planned(date);
        if (ours !== theirs) mismatches.push({ date, s, ours, theirs });
      }
    }
    expect(mismatches).toEqual([]);
  });
});
