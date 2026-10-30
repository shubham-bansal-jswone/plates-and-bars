import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  WEEKLY_INTAKE_MIN_DAYS, addDays, habits, weeklyIntake, intakeAverage, weeksOnTrackSeries, weekSummary,
  type IntakeTargets, type ProgressDay, type WeekOnTrack, type WeeklyIntake,
} from '../src/index';
import { weekOnTrack, weeklySessionGoal } from '../src/progress';

const golden = (n: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/spec/golden/${n}.json`), 'utf8'));
type RawDay = { date: string; logs: { kcal: number; protein_g: number; qty: number; deleted_at: string | null }[] };
const gi = golden('weeklyIntake') as {
  min_days: number;
  intake_average: { note: string; weeks: { loggedDays: number; avgKcal: number | null; avgProtein_g: number | null }[]; last_n?: number; expected: { avgKcal: number | null; avgProtein_g: number | null; loggedDays: number } }[];
  weekly_intake: { note: string; end: string; weeks: number; targets: IntakeTargets; days: RawDay[]; expected: WeeklyIntake[] }[];
};
const go = golden('weeksOnTrack') as {
  cases: { note: string; end: string; weeks: number; profile: { days: number } | null; sessions: Record<string, { t: string; n: number }>; expected: WeekOnTrack[] }[];
};
const toDays = (raw: RawDay[]): ProgressDay[] =>
  raw.map((d) => ({ date: d.date, trained: false, logs: d.logs.map((l) => ({ ...l, id: 'x', name: 'f', carbs_g: 0, fat_g: 0 })) as unknown as ProgressDay['logs'] }));

describe('intakeAverage (#1351 A6)', () => {
  it.each(gi.intake_average.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const r = intakeAverage(c.weeks, c.last_n);
    expect(r.loggedDays).toBe(c.expected.loggedDays);
    for (const k of ['avgKcal', 'avgProtein_g'] as const) {
      if (c.expected[k] === null) expect(r[k]).toBeNull();
      else expect(r[k]).toBeCloseTo(c.expected[k]!, 9);
    }
  });
  it('works on weeklyIntake output end to end', () => {
    const c = gi.weekly_intake[0]!;
    const r = intakeAverage(weeklyIntake(toDays(c.days), c.end, 3, c.targets));
    expect(r.loggedDays).toBe(c.expected.reduce((n, w) => n + w.loggedDays, 0));
  });
});

describe('weeklyIntake (#1351 C4)', () => {
  it('constant matches the vectors', () => expect(WEEKLY_INTAKE_MIN_DAYS).toBe(gi.min_days));
  it.each(gi.weekly_intake.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    expect(weeklyIntake(toDays(c.days), c.end, c.weeks, c.targets)).toEqual(c.expected);
  });
  it('agrees with weekSummary on a Monday-Sunday window (same logged-day rule)', () => {
    const c = gi.weekly_intake[0]!, days = toDays(c.days);
    const ws = weekSummary(days, '2026-10-25', 2200), wi = weeklyIntake(days, '2026-10-25', 1, c.targets)[0]!;
    expect(wi.avgKcal).toBe(ws.avgKcal);
    expect(wi.avgProtein_g).toBe(ws.avgProtein_g);
  });
  it('the complete flag does not decide a logged day', () => {
    const d: ProgressDay = { ...toDays(gi.weekly_intake[0]!.days)[1]!, complete: false };
    expect(weeklyIntake([d], '2026-10-25', 1, { kcal: 1, protein_g: 1 })[0]!.loggedDays).toBe(1);
  });
  it('a date given twice: the first copy wins, as in weekSummary, even when it has no live log', () => {
    const [blank, full] = [{ ...toDays(gi.weekly_intake[0]!.days)[5]!, logs: [] }, toDays(gi.weekly_intake[0]!.days)[5]!];
    const t = { kcal: 1, protein_g: 1 };
    expect(weeklyIntake([blank, full], '2026-10-29', 1, t)[0]!.loggedDays).toBe(0);
    expect(weeklyIntake([full, blank], '2026-10-29', 1, t)[0]!.loggedDays).toBe(1);
    expect(weekSummary([blank, full], '2026-10-26', 1).days[6]!.logged).toBe(false);
  });
  it('a date given twice counts once; weeks below 1 or NaN give none; fractions floor', () => {
    const days = toDays(gi.weekly_intake[0]!.days), t = { kcal: 1, protein_g: 1 };
    expect(weeklyIntake([...days, ...days], '2026-10-29', 3, t)).toEqual(weeklyIntake(days, '2026-10-29', 3, t));
    expect(weeklyIntake(days, '2026-10-29', 0, t)).toEqual([]);
    expect(weeklyIntake(days, '2026-10-29', NaN, t)).toEqual([]);
    expect(weeklyIntake(days, '2026-10-29', 2.9, t)).toHaveLength(2);
  });
});

describe('weeksOnTrackSeries (#1351 C5)', () => {
  it.each(go.cases.map((c) => [c.note, c] as const))('%s', (_n, c) => {
    const s = weeksOnTrackSeries(c.sessions, c.profile, c.end, c.weeks);
    expect(s).toEqual(c.expected);
  });
  it.each(go.cases.map((c) => [c.note, c] as const))('trailing run equals habits().weeks: %s', (_n, c) => {
    const s = weeksOnTrackSeries(c.sessions, c.profile, c.end, 26);
    let run = 0;
    for (let i = s.length - 1; i >= 0 && s[i]!.onTrack; i--) run++;
    expect(run).toBe(habits(c.end, c.sessions, c.profile, []).weeks);
  });
  it('trailing run equals habits().weeks over many generated histories, with a run capped at 26', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const end = '2026-10-29';
    for (let i = 0; i < 60; i++) {
      const sessions: Record<string, { t: string; n: number }> = {}, density = r();
      for (let b = 0; b < 260; b++) if (r() < density) sessions[addDays(end, -b)] = { t: 'Push A', n: 5 };
      const profile = r() < 0.1 ? null : { days: Math.floor(r() * 7) };
      const s = weeksOnTrackSeries(sessions, profile, end, 40);
      let run = 0;
      for (let k = s.length - 1; k >= 0 && s[k]!.onTrack; k--) run++;
      expect(Math.min(run, 26)).toBe(habits(end, sessions, profile, []).weeks);
    }
  });
  it('a full history is on track every week, capped by habits at 26', () => {
    const sessions: Record<string, { t: string; n: number }> = {};
    for (let b = 0; b < 400; b++) sessions[addDays('2026-10-29', -b)] = { t: 'A', n: 1 };
    const s = weeksOnTrackSeries(sessions, { days: 4 }, '2026-10-29', 30);
    expect(s.every((w) => w.onTrack)).toBe(true);
    expect(habits('2026-10-29', sessions, { days: 4 }, []).weeks).toBe(26);
  });
  it('weeks below 1 or NaN give none; the goal rule is shared', () => {
    expect(weeksOnTrackSeries({}, null, '2026-10-29', 0)).toEqual([]);
    expect(weeksOnTrackSeries({}, null, '2026-10-29', NaN)).toEqual([]);
    expect([null, { days: 0 }, { days: 2 }, { days: 4 }].map(weeklySessionGoal)).toEqual([5, 2, 2, 3]);
    expect(weekOnTrack(['2026-10-19', '2026-10-25'], '2026-10-19', 2)).toBe(true);
    expect(weekOnTrack(['2026-10-19', '2026-10-26'], '2026-10-19', 2)).toBe(false);
  });
});
