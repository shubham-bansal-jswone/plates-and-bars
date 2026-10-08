import {
  mergeSecondSession,
  planList,
  secondSessionChoices,
  sessionMods,
  sessionVolume,
  templateName,
  type AdjRange,
  type CiChoice,
  type HealthProfile,
  type PlanProfile,
  type ReentryRange,
  type SessionModsInput,
  type Where,
} from '../src/index';
import { loadDay } from './prototype-day';
import { rng } from './prototype-plan';

// No golden fixture covers these rules; they are checked against the prototype's own functions
// (differential tests below, cut from the HTML) and by hand-worked unit tests.
const proto = loadDay();
const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const RUNS = 3000;
const DATE = '2026-05-13';

describe('sessionMods', () => {
  const base: SessionModsInput = { date: DATE, where: 'gym' };
  it('a plain day: nothing on', () => {
    expect(sessionMods(base)).toEqual({ light: false, mods: { light: false, short: false, where: 'gym', deload: false, reentry: 0 } });
  });
  it('check-in light, lab hold and clearance make the stored mods light', () => {
    expect(sessionMods({ ...base, ciChoice: 'light' }).mods.light).toBe(true);
    expect(sessionMods({ ...base, ciChoice: 'swap' }).mods.light).toBe(false);
    expect(sessionMods({ ...base, labHold: true })).toMatchObject({ light: true, mods: { light: true } });
    expect(sessionMods({ ...base, profile: { screen: ['no', 'yes'] } })).toMatchObject({ light: true, mods: { light: true } });
    expect(sessionMods({ ...base, profile: { screen: ['no', 'yes'], cleared: '2026-01-01' } }).light).toBe(false);
  });
  it('re-entry of 30% makes the sets light but not the stored flag (pins the prototype)', () => {
    const r: ReentryRange = { from: DATE, until: '2026-05-26', pct: 0.3 };
    expect(sessionMods({ ...base, reentry: r })).toEqual({ light: true, mods: { light: false, short: false, where: 'gym', deload: false, reentry: 0.3 } });
    expect(sessionMods({ ...base, reentry: { ...r, pct: 0.15 } })).toMatchObject({ light: false, mods: { reentry: 0.15 } });
    expect(sessionMods({ ...base, reentry: { ...r, from: '2026-05-14' } }).mods.reentry).toBe(0);
  });
  it('short when the time answer is not "usual"; deload when the recovery week covers the date', () => {
    expect(sessionMods({ ...base, time: '30' }).mods.short).toBe(true);
    expect(sessionMods({ ...base, time: 'usual' }).mods.short).toBe(false);
    expect(sessionMods({ ...base, deload: { until: DATE } }).mods.deload).toBe(true);
    expect(sessionMods({ ...base, deload: { until: '2026-05-12' } }).mods.deload).toBe(false);
    expect(sessionMods({ ...base, where: 'bodyweight' }).mods.where).toBe('bodyweight');
  });
});

describe('templateName', () => {
  it('appends the away-from-gym suffix', () => {
    expect(templateName('Upper A', 'gym')).toBe('Upper A');
    expect(templateName('Upper A', 'dumbbells')).toBe('Upper A (dumbbells only)');
    expect(templateName('Upper A', 'bodyweight')).toBe('Upper A (bodyweight)');
  });
});

describe('sessionMods and templateName match prototype buildSession', () => {
  it(`over ${RUNS} random days`, () => {
    const r = rng(142);
    const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const days = ['2026-05-06', '2026-05-12', DATE, '2026-05-14', '2026-05-20'];
    const range = (): AdjRange | null | undefined => pickOf([undefined, null, { until: pickOf(days) }, { from: pickOf(days), until: pickOf(days) }]);
    const profiles: (HealthProfile | null | undefined)[] = [
      undefined,
      null,
      {},
      { screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
      { screen: { '0': 'no', '3': 'yes' } },
      { screen: ['yes'], cleared: '2026-01-01' },
      { special: 'pregnant' },
      { special: 'pregnant', cleared: '2026-02-02' },
      { special: 'breastfeeding' },
    ];
    let lightDiffers = 0;
    for (let k = 0; k < RUNS; k++) {
      const ciChoice = pickOf<CiChoice | null | undefined>([undefined, null, 'light', 'swap', 'orig']);
      const time = pickOf([undefined, null, '', 'usual', '45', '30']);
      const where = pickOf<Where>(['gym', 'dumbbells', 'bodyweight']);
      const profile = pickOf(profiles);
      const labHold = pickOf([undefined, { on: false }, { on: true }]);
      const deload = range();
      const rr = range();
      const reentry = rr ? { ...rr, pct: pickOf([0.15, 0.3]) } : rr;
      const t = pickOf(['Push A', 'Upper B', 'Full A', '']);
      const date = pickOf(days);

      proto.S.date = date;
      proto.S.settings = clone({ profile, labHold, adj: { deload, reentry } }) as Record<string, unknown>;
      proto.S.day.workout = clone({ ciChoice, checkin: time === undefined ? undefined : { time }, where }) as Record<string, unknown>;
      const p = proto.mods(t);

      const got = sessionMods({ date, ciChoice, time, where, profile, labHold: !!labHold?.on, deload, reentry });
      expect(got.light).toBe(p.light);
      expect(got.mods).toEqual({ light: p.mods.light, short: !!p.mods.short, where: p.mods.where, deload: !!p.mods.deload, reentry: p.mods.reentry });
      expect(templateName(t, where)).toBe(p.template);
      if (got.light !== got.mods.light) lightDiffers++;
    }
    expect(lightDiffers).toBeGreaterThan(0);
  });
});

describe('sessionVolume', () => {
  it('sums weight x reps over ticked sets, commas as decimals, blanks as 0', () => {
    expect(sessionVolume([])).toBe(0);
    expect(
      sessionVolume([
        { sets: [{ done: true, w: '60', r: '8' }, { done: false, w: '60', r: '8' }, { done: true, w: '62,5', r: '6' }] },
        { sets: [{ done: true, w: '', r: '12' }, { done: true, w: 20, r: 10 }, { done: true, w: null, r: null }] },
      ]),
    ).toBe(480 + 375 + 200);
  });
  it(`matches prototype renderWorkout over ${RUNS} random sessions`, () => {
    const r = rng(7);
    const vals = ['', '0', '5', '12,5', '20.25', '100', 'abc', ' 7', '1e2', null, 0, 42.5, undefined];
    for (let k = 0; k < RUNS; k++) {
      const exercises = Array.from({ length: Math.floor(r() * 5) }, () => ({
        sets: Array.from({ length: Math.floor(r() * 5) }, () => ({
          done: r() < 0.6,
          w: vals[Math.floor(r() * vals.length)],
          r: vals[Math.floor(r() * vals.length)],
        })),
      }));
      proto.S.day.workout = { exercises: exercises.map((e) => ({ sets: e.sets.map((s) => ({ ...s })) })) };
      expect(sessionVolume(exercises)).toBe(proto.volume());
    }
  });
});

describe('secondSessionChoices', () => {
  const p: PlanProfile = { days: 3 };
  const done = { sets: [{ done: false }, { done: true }] };
  it('offered once every exercise has a ticked set, without today’s base', () => {
    expect(secondSessionChoices({ exercises: [done], template: 'Full A', base: 'Full A' }, p)).toEqual(planList(p).filter((t) => t !== 'Full A'));
  });
  it('not offered with no exercises, an untouched exercise, or two sessions already', () => {
    expect(secondSessionChoices({ exercises: [], template: 'Full A', base: 'Full A' }, p)).toBeNull();
    expect(secondSessionChoices({ exercises: [done, { sets: [{ done: false }] }], template: 'Full A' }, p)).toBeNull();
    expect(secondSessionChoices({ exercises: [done, { sets: [] }], template: 'Full A' }, p)).toBeNull();
    expect(secondSessionChoices({ exercises: [done], template: 'Full A + Full B', base: 'Full A' }, p)).toBeNull();
  });
  it(`matches prototype secondSessionHtml over ${RUNS} random days`, () => {
    const r = rng(2);
    const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const profiles: (PlanProfile | null | undefined)[] = [undefined, null, {}, ...[0, 1, 2, 3, 4, 5, 6, 7].map((days) => ({ days }))];
    for (let k = 0; k < RUNS; k++) {
      const exercises = Array.from({ length: Math.floor(r() * 4) }, () => ({
        sets: Array.from({ length: Math.floor(r() * 3) }, () => ({ done: r() < 0.75 })),
      }));
      const template = pickOf([undefined, null, '', 'Push A', 'Upper A (dumbbells only)', 'Push A + Pull A', 'Session + Legs A', 'A+B']);
      const base = pickOf([undefined, null, '', 'Push A', 'Upper A', 'Full A', 'Lower B']);
      const profile = pickOf(profiles);
      proto.S.settings = clone({ profile }) as Record<string, unknown>;
      proto.S.day.workout = clone({ exercises, template, base }) as Record<string, unknown>;
      const html = proto.secondSessionHtml();
      const want = html === '' ? null : [...html.matchAll(/data-act="second" data-v="([^"]*)"/g)].map((m) => m[1]);
      expect(secondSessionChoices({ exercises, template, base }, profile)).toEqual(want);
    }
  });
});

describe('mergeSecondSession', () => {
  it('appends new exercises as part 2 and joins the names', () => {
    const old = { exercises: [{ name: 'Bench Press' }, { name: 'Row' }], template: 'Push A (dumbbells only)', base: 'Push A', mods: { light: false, short: true, where: 'dumbbells' as const } };
    const built = { exercises: [{ name: 'Row' }, { name: 'Squat' }], mods: { light: true, short: false } };
    const out = mergeSecondSession(old, 'Legs A', built);
    expect(out).toEqual({
      exercises: [{ name: 'Bench Press' }, { name: 'Row' }, { name: 'Squat', part: 2 }],
      template: 'Push A (dumbbells only) + Legs A',
      base: 'Push A',
      mods: { light: true, short: true, where: 'dumbbells' },
    });
    expect(built.exercises[1]).toEqual({ name: 'Squat' });
  });
  it('defaults: "Session" with no template, base becomes t, light false with no mods', () => {
    expect(mergeSecondSession({ exercises: [], template: null, base: '', mods: null }, 'Pull A', { exercises: [] })).toEqual({
      exercises: [],
      template: 'Session + Pull A',
      base: 'Pull A',
      mods: { light: false },
    });
  });
  it(`matches prototype addSecondSession over ${RUNS} random days`, () => {
    const r = rng(9);
    const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const pool = ['Bench Press', 'Row', 'Squat', 'Curl', 'Plank', 'Lunge', 'Dip'];
    const some = (): { name: string; part?: number; sets: { done: boolean }[] }[] =>
      pool.filter(() => r() < 0.4).map((name) => ({ name, ...(r() < 0.3 ? { part: 1 } : {}), sets: [{ done: r() < 0.5 }] }));
    const modsOf = (): Record<string, unknown> | undefined | null =>
      pickOf([undefined, null, {}, { light: true }, { light: false, short: true, where: 'gym', deload: false, reentry: 0.15 }, { light: 0 }]);
    for (let k = 0; k < RUNS; k++) {
      const old = { exercises: some(), template: pickOf([undefined, null, '', 'Push A', 'Upper A (bodyweight)']), base: pickOf([undefined, null, '', 'Push A']), mods: modsOf() };
      const built = { exercises: some(), mods: modsOf() };
      const t = pickOf(['Pull A', 'Legs B', 'Full A']);
      proto.S.day.workout = clone(old) as Record<string, unknown>;
      proto.addSecondSession(t, clone(built) as { exercises: unknown[]; mods: unknown });
      const w = proto.S.day.workout;
      const got = mergeSecondSession(old as Parameters<typeof mergeSecondSession>[0], t, built as Parameters<typeof mergeSecondSession>[2]);
      expect(clone(got)).toEqual(clone({ exercises: w.exercises, template: w.template, base: w.base, mods: w.mods }));
    }
  });
});
