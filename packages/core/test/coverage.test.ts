import {
  addDays,
  COVER_SHOW,
  coverageRows,
  coverageTemplates,
  doneCoverage,
  FOCUS_MAX,
  focusPicker,
  mondayOf,
  plannedCoverage,
  SPLITS,
  TEMPLATES,
  toggleFocus,
  weeklyCoverage,
  type CoverageRow,
  type CoverageDay,
  type CoverageSet,
  type Exclusion,
  type ExclusionScope,
  type PlanProfile,
  type Swap,
  type WeekPlan,
  type Where,
} from '../src/index';
import { loadCoverage, type ProtoDayDoc } from './prototype-coverage';
import { goldenCatalog, rng } from './prototype-plan';

// No golden fixture covers coverage or the focus picker; they are checked against the prototype's own
// functions (differential tests below, cut from the HTML) and by hand-worked unit tests.
const catalog = goldenCatalog();
const { tags } = catalog;
const proto = loadCoverage();
const DATE = '2026-10-08'; // a Thursday

const set = (exercise: string, done = true, more: Partial<CoverageSet> = {}): CoverageSet => ({ exercise, kind: 'work', done, ...more });
const day = (date: string, names: string[] | null, sets: CoverageSet[], deleted_at?: string): CoverageDay => ({
  date,
  workout: names ? { exercises: names.map((name) => ({ name })), ...(deleted_at ? { deleted_at } : {}) } : null,
  sets,
});

/** A row as the prototype's meter draws it, with the prototype's own labels. */
function rowHtml(r: CoverageRow): string {
  return `<div class="cv-r"><span>${proto.MUSCLE[r.muscle]}</span><div class="cv-bar"><i style="width:${r.barPct}%" class="${r.low ? 'low' : ''}"></i></div><b class="${r.low ? 'lowt' : ''}">${r.shown}</b></div>`;
}
const meterHtml = (rows: CoverageRow[]) => `<div class="cover">${rows.map(rowHtml).join('')}</div>`;

describe('plannedCoverage', () => {
  it('counts 3 sets per exercise on primary muscles and 1.5 on secondary, over every template of the split', () => {
    const p: PlanProfile = { days: 2 };
    const want: Record<string, number> = {};
    for (const t of SPLITS[2].list)
      for (const n of TEMPLATES[t] as string[]) {
        const tg = tags[n];
        if (!tg) continue;
        for (const m of tg.primary) want[m] = (want[m] || 0) + 3;
        for (const m of tg.secondary) want[m] = (want[m] || 0) + 1.5;
      }
    expect(plannedCoverage({ date: DATE, profile: p }, catalog)).toEqual(want);
  });

  it('a hand-worked catalogue: primary 3, secondary half, bridge 2 and 1, untagged nothing', () => {
    const tag = (primary: string[], secondary: string[]) => ({ pattern: 'x', family: 'x', equipment: 'machine', difficulty: 1, primary, secondary, joints: [] });
    const small = {
      tags: { 'Hack Squat': tag(['quads'], ['glutes']), 'Leg Press': tag(['quads', 'glutes'], ['hams']) },
      away_map: { dumbbells_bodyweight: {} },
    };
    // Full body A: Hack Squat is tagged; the rest of the template is not in this catalogue.
    expect(plannedCoverage({ date: DATE, weekPlan: { start: mondayOf(DATE), list: ['Full body A'] } }, small)).toEqual({ quads: 3, glutes: 1.5 });
    // A swap Hack Squat → Leg Press with a bridge: Leg Press 3, Hack Squat 2 as the bridge.
    const swaps: Swap[] = [{ from: 'Hack Squat', to: 'Leg Press', bridge_until: DATE }];
    expect(plannedCoverage({ date: DATE, weekPlan: { start: mondayOf(DATE), list: ['Full body A'] }, swaps }, small)).toEqual({ quads: 5, glutes: 4, hams: 1.5 });
    // The bridge has ended the day before.
    expect(plannedCoverage({ date: addDays(DATE, 1), weekPlan: { start: mondayOf(DATE), list: ['Full body A'] }, swaps }, small)).toEqual({ quads: 3, glutes: 3, hams: 1.5 });
  });

  it('uses the week plan only in its own week', () => {
    const wp: WeekPlan = { start: mondayOf(DATE), list: ['Push A'] };
    expect(coverageTemplates(DATE, { days: 3 }, wp)).toEqual(['Push A']);
    expect(coverageTemplates(addDays(mondayOf(DATE), 6), { days: 3 }, wp)).toEqual(['Push A']); // Sunday of that week
    expect(coverageTemplates(addDays(mondayOf(DATE), 7), { days: 3 }, wp)).toEqual(SPLITS[3].list);
    expect(coverageTemplates(DATE, { days: 3 }, { start: addDays(mondayOf(DATE), 7), list: ['Push A'] })).toEqual(SPLITS[3].list);
  });

  it('no plan at 0 days; the 6-day split with no profile or no days', () => {
    expect(plannedCoverage({ date: DATE, profile: { days: 0 } }, catalog)).toEqual({});
    expect(coverageTemplates(DATE, null)).toEqual(SPLITS[6].list);
    expect(coverageTemplates(DATE, { days: null })).toEqual(SPLITS[6].list);
  });

  it('maps for the profile’s where and leaves out excluded exercises with no replacement', () => {
    const gym = plannedCoverage({ date: DATE, profile: { days: 3 } }, catalog);
    const bw = plannedCoverage({ date: DATE, profile: { days: 3, where: 'bodyweight' } }, catalog);
    expect(bw).not.toEqual(gym);
    const skip: Exclusion = { scope: 'exercise', key: 'Hack Squat', reason: null, to: { 'Hack Squat': null }, done: false };
    const without = plannedCoverage({ date: DATE, profile: { days: 3 }, exclusions: [skip] }, catalog);
    expect(without.quads).toBeLessThan(gym.quads as number);
  });
});

describe('doneCoverage', () => {
  const D = (date: string) => day(date, ['Leg Press', 'Lat Pulldown'], [set('Leg Press'), set('Leg Press'), set('Lat Pulldown', false)]);

  it('counts ticked work sets over the 7 days ending on the date', () => {
    const days = [D(DATE), D(addDays(DATE, -6)), D(addDays(DATE, -7)), D(addDays(DATE, 1))];
    const lp = tags['Leg Press'];
    const want: Record<string, number> = {};
    for (const m of lp?.primary ?? []) want[m] = 4;
    for (const m of lp?.secondary ?? []) want[m] = (want[m] || 0) + 2;
    for (const m of tags['Lat Pulldown']?.primary ?? []) want[m] = (want[m] || 0) + 0;
    for (const m of tags['Lat Pulldown']?.secondary ?? []) want[m] = (want[m] || 0) + 0;
    expect(doneCoverage(DATE, days, tags)).toEqual(want);
  });

  it('two workouts on different days listing the same exercise count their own sets only', () => {
    const one = doneCoverage(DATE, [day(DATE, ['Leg Press'], [set('Leg Press')])], tags);
    const three = doneCoverage(DATE, [day(addDays(DATE, -2), ['Leg Press'], [set('Leg Press'), set('Leg Press')])], tags);
    const both = doneCoverage(DATE, [day(DATE, ['Leg Press'], [set('Leg Press')]), day(addDays(DATE, -2), ['Leg Press'], [set('Leg Press'), set('Leg Press')])], tags);
    for (const m of tags['Leg Press']?.primary ?? []) {
      expect(one[m]).toBe(1);
      expect(three[m]).toBe(2);
      expect(both[m]).toBe(3);
    }
  });

  it('skips ramp sets, deleted sets, deleted workouts, days with no workout, sets of other exercises and untagged exercises', () => {
    const sets = [set('Leg Press', true, { kind: 'ramp' }), set('Leg Press', true, { deleted_at: '2026-10-08T10:00:00Z' }), set('Hack Squat'), set('My Sled')];
    const got = doneCoverage(DATE, [day(DATE, ['Leg Press', 'My Sled'], sets), day(addDays(DATE, -1), ['Leg Press'], [set('Leg Press')], '2026-10-08T10:00:00Z'), day(addDays(DATE, -2), null, [set('Leg Press')])], tags);
    expect(Object.values(got).every((v) => v === 0)).toBe(true);
    expect(doneCoverage(DATE, [], tags)).toEqual({});
  });
});

describe('coverageRows and weeklyCoverage', () => {
  it('rows in COVER_SHOW order; 0 for missing; flagged under 6; bar capped at 100%', () => {
    const rows = coverageRows({ chest: 5.5, lats: 6, abs: 14, forearms: 9 });
    expect(rows.map((r) => r.muscle)).toEqual(COVER_SHOW);
    expect(rows[0]).toEqual({ muscle: 'chest', sets: 5.5, shown: 6, low: true, barPct: (5.5 / 12) * 100 });
    expect(rows[1]).toMatchObject({ muscle: 'lats', shown: 6, low: false, barPct: 50 });
    expect(rows[11]).toMatchObject({ muscle: 'abs', shown: 14, barPct: 100 });
    expect(rows[2]).toEqual({ muscle: 'upper-back', sets: 0, shown: 0, low: true, barPct: 0 });
  });

  it('weeklyCoverage gives both meters', () => {
    const days = [day(DATE, ['Leg Press'], [set('Leg Press')])];
    const got = weeklyCoverage({ date: DATE, profile: { days: 4 }, days }, catalog);
    expect(got.planned).toEqual(coverageRows(plannedCoverage({ date: DATE, profile: { days: 4 } }, catalog)));
    expect(got.done).toEqual(coverageRows(doneCoverage(DATE, days, tags)));
  });
});

describe('focus picker', () => {
  it('toggles: adds at the end, removes, refuses a fourth', () => {
    expect(toggleFocus(null, 'chest')).toEqual({ focus: ['chest'], result: 'added' });
    expect(toggleFocus(['chest', 'lats'], 'chest')).toEqual({ focus: ['lats'], result: 'removed' });
    expect(toggleFocus(['chest', 'lats', 'abs'], 'glutes')).toEqual({ focus: ['chest', 'lats', 'abs'], result: 'full' });
    expect(FOCUS_MAX).toBe(3);
  });

  it('PINNED QUIRK (#155): a stored list of more than 3 can still lose its 4th (unseen) muscle, and toggleFocus does not check COVER_SHOW', () => {
    expect(toggleFocus(['chest', 'lats', 'abs', 'glutes'], 'glutes')).toEqual({ focus: ['chest', 'lats', 'abs'], result: 'removed' });
    expect(focusPicker(['chest', 'lats', 'abs', 'glutes']).chips.find((c) => c.muscle === 'glutes')?.pressed).toBe(false);
    expect(toggleFocus([], 'forearms')).toEqual({ focus: ['forearms'], result: 'added' });
  });

  it('picker: a chip per COVER_SHOW muscle, notes for abs and any focus', () => {
    expect(focusPicker(undefined)).toEqual({ chips: COVER_SHOW.map((muscle) => ({ muscle, pressed: false })), absNote: false, volumeHint: false });
    const p = focusPicker(['abs', 'lats']);
    expect(p.chips.filter((c) => c.pressed).map((c) => c.muscle)).toEqual(['lats', 'abs']);
    expect(p).toMatchObject({ absNote: true, volumeHint: true });
  });
});

describe('differential: the prototype’s own functions', () => {
  const all = Object.keys(tags);
  const CUSTOM = ['Sled Push', 'Battle Ropes'];
  const SCOPES: ExclusionScope[] = ['exercise', 'family', 'pattern', 'joint'];
  const REASONS = ['pain', 'equip', 'dislike', 'form', null] as const;
  const WHERES: (Where | undefined)[] = ['gym', 'dumbbells', 'bodyweight', undefined];
  const MUSCLES = Object.keys(proto.MUSCLE);
  const CONDENSED = [SPLITS[3].list, SPLITS[4].list, SPLITS[5].list];

  interface Case {
    date: string;
    profile: PlanProfile | null;
    weekPlan: WeekPlan | null;
    exclusions: Exclusion[];
    swaps: Swap[];
    lifts: Record<string, unknown>;
    days: CoverageDay[];
  }

  function randomCase(r: () => number): Case {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const date = addDays('2026-01-01', Math.floor(r() * 400));
    const pool = Array.from({ length: 6 + Math.floor(r() * 10) }, () => (r() < 0.05 ? pick(CUSTOM) : pick(all)));
    const keyFor = (scope: ExclusionScope): string => {
      const n = pick(pool);
      const t = tags[n];
      if (scope === 'exercise' || !t) return n;
      if (scope === 'family') return t.family;
      if (scope === 'pattern') return t.pattern;
      return t.joints.length ? pick(t.joints) : 'neck';
    };
    const exclusions: Exclusion[] = Array.from({ length: Math.floor(r() * 3) }, () => {
      const scope = pick(SCOPES);
      const to: Record<string, string | null> = {};
      for (let k = Math.floor(r() * 3); k > 0; k--) to[pick(pool)] = r() < 0.3 ? null : pick(pool);
      return { scope, key: keyFor(scope), reason: pick(REASONS), to, done: r() < 0.15, ...(r() < 0.1 ? { deleted_at: '2026-10-01T00:00:00Z' } : {}) };
    });
    const swaps: Swap[] = Array.from({ length: Math.floor(r() * 4) }, () => ({
      from: pick(pool),
      to: pick(pool),
      bridge_until: r() < 0.4 ? null : addDays(date, Math.floor(r() * 7) - 3),
      ...(r() < 0.1 ? { deleted_at: '2026-10-01T00:00:00Z' } : {}),
    }));
    const lifts = Object.fromEntries(all.filter(() => r() < 0.2).map((n) => [n, { sets: [] }]));
    const daysR = r();
    const where = pick(WHERES);
    const profile: PlanProfile | null =
      r() < 0.05 ? null : { ...(daysR < 0.1 ? {} : daysR < 0.15 ? { days: null } : { days: Math.floor(r() * 8) }), ...(where ? { where } : {}) };
    const wr = r();
    const weekPlan: WeekPlan | null =
      wr < 0.5 ? null : { start: wr < 0.8 ? mondayOf(date) : addDays(mondayOf(date), pick([-7, 7])), list: r() < 0.9 ? pick(CONDENSED) : [pick(Object.keys(TEMPLATES)), 'No Such Day'] };
    // Logged days around the 7-day window, one entry per date, in contract shapes (no ids, as stored locally).
    const days: CoverageDay[] = [];
    for (let k = -9; k <= 1; k++) {
      if (r() < 0.3) continue;
      if (r() < 0.05) {
        days.push({ date: addDays(date, k), workout: null, sets: [] });
        continue;
      }
      const names = [...new Set(Array.from({ length: 1 + Math.floor(r() * 6) }, () => (r() < 0.05 ? pick(CUSTOM) : pick(all))))];
      const sets: CoverageSet[] = [];
      for (const n of names)
        for (let j = Math.floor(r() * 6); j > 0; j--)
          sets.push({ exercise: r() < 0.03 ? pick(all) : n, kind: r() < 0.15 ? 'ramp' : 'work', done: r() < 0.7, ...(r() < 0.05 ? { deleted_at: '2026-10-01T00:00:00Z' } : {}) });
      days.push({ date: addDays(date, k), workout: { exercises: names.map((name) => ({ name })), ...(r() < 0.05 ? { deleted_at: '2026-10-01T00:00:00Z' } : {}) }, sets });
    }
    return { date, profile, weekPlan, exclusions, swaps, lifts, days };
  }

  /** Day entries in contract shapes → prototype day docs keyed by date (deleted records left out). */
  function toDays(c: Case): Record<string, ProtoDayDoc> {
    const out: Record<string, ProtoDayDoc> = {};
    for (const { date, workout: w, sets } of c.days) {
      if (!w || w.deleted_at) continue;
      const live = sets.filter((s) => !s.deleted_at);
      out[date] = {
        meals: [],
        workout: {
          exercises: w.exercises.map((e) => ({
            name: e.name,
            sets: live.filter((s) => s.exercise === e.name && s.kind === 'work').map((s) => ({ done: s.done })),
            ramp: live.filter((s) => s.exercise === e.name && s.kind === 'ramp').map((s) => ({ done: s.done })),
          })),
        },
      };
    }
    return out;
  }

  function setProto(c: Case): void {
    const days = toDays(c);
    proto.S.date = c.date;
    proto.S.settings = {
      excl: c.exclusions.filter((x) => !x.deleted_at).map((x) => ({ scope: x.scope, key: x.key, reason: x.reason, to: { ...x.to }, done: x.done })),
      repl: Object.fromEntries(c.swaps.filter((w) => !w.deleted_at).map((w) => [w.from, { to: w.to, bridgeUntil: w.bridge_until }])),
      profile: c.profile ? { ...c.profile } : c.profile,
      adj: c.weekPlan ? { weekPlan: { start: c.weekPlan.start, list: [...c.weekPlan.list] } } : {},
    };
    proto.S.lifts = { ...c.lifts };
    proto.S.store = days;
    proto.S.dayCache = {};
    proto.S.day = days[c.date] ?? { meals: [], workout: { exercises: [] } };
  }

  it('slices the prototype functions', () => {
    expect(typeof proto.weeklyCoverage).toBe('function');
    expect(COVER_SHOW).toEqual(proto.COVER_SHOW);
  });

  it('planned and done coverage match the prototype over 3,000 seeded random states', async () => {
    const r = rng(148);
    let weekPlans = 0;
    let halves = 0;
    let lowAndHigh = 0;
    let windowEdges = 0;
    for (let i = 0; i < 3000; i++) {
      const c = randomCase(r);
      setProto(c);
      const planned = plannedCoverage(c, catalog);
      expect(planned).toEqual(proto.weeklyCoverage());
      expect(proto.coverageHtml().split('\n')[0]).toBe(meterHtml(coverageRows(planned)));
      const done = doneCoverage(c.date, c.days, tags);
      expect(done).toEqual(await proto.actualCoverage());
      proto.S.dayCache = {};
      expect(await proto.fillActualCoverage()).toBe(meterHtml(coverageRows(done)));
      expect(weeklyCoverage(c, catalog)).toEqual({ planned: coverageRows(planned), done: coverageRows(done) });
      weekPlans += c.weekPlan && c.weekPlan.start === mondayOf(c.date) ? 1 : 0;
      halves += Object.values(done).some((v) => v % 1 !== 0) ? 1 : 0;
      const rows = coverageRows(done);
      lowAndHigh += rows.some((x) => x.low && x.sets > 0) && rows.some((x) => x.barPct === 100) ? 1 : 0;
      windowEdges += c.days.some((d) => d.date === addDays(c.date, -6)) && c.days.some((d) => d.date === addDays(c.date, -7)) ? 1 : 0;
    }
    // The grid reaches the interesting branches.
    expect(weekPlans).toBeGreaterThan(500);
    expect(halves).toBeGreaterThan(500);
    expect(lowAndHigh).toBeGreaterThan(100);
    expect(windowEdges).toBeGreaterThan(500);
  });

  it('focus toggling and the picker match the prototype over 5,000 seeded random taps', () => {
    const r = rng(3984);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    let full = 0;
    for (let i = 0; i < 5000; i++) {
      const focus = r() < 0.05 ? undefined : Array.from({ length: Math.floor(r() * 5) }, () => (r() < 0.85 ? pick(COVER_SHOW) : pick(MUSCLES)));
      const m = r() < 0.9 ? pick(COVER_SHOW) : pick(MUSCLES);
      proto.S.settings = { excl: [], repl: {}, ...(focus ? { focus: [...focus] } : {}) };
      const html = proto.focusHtml();
      const p = focusPicker(focus);
      for (const ch of p.chips) expect(html).toContain(`data-v="${ch.muscle}" aria-pressed="${ch.pressed}"`);
      expect(html.includes('belly fat')).toBe(p.absNote);
      expect(html.includes('12–16 weekly sets')).toBe(p.volumeHint);
      const { toasts, saved } = proto.focusAction(m);
      const got = toggleFocus(focus, m);
      expect(got.focus).toEqual(proto.S.settings.focus);
      expect(saved).toBe(got.result !== 'full');
      expect(toasts[0] === 'Up to 3 focus muscles. Remove one first.').toBe(got.result === 'full');
      if (got.result !== 'full') expect(toasts[0]).toBe(got.focus.length ? `Focus: ${got.focus.map((x) => proto.MUSCLE[x]).join(', ').replace(/, ([^,]*)$/, ' and $1')}` : 'No focus muscles');
      full += got.result === 'full' ? 1 : 0;
    }
    expect(full).toBeGreaterThan(200);
  });
});
