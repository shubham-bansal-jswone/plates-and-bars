import {
  applyFocus,
  BALANCE_EXERCISE,
  focusPick,
  isFocus,
  mapForWhere,
  muscleAllowed,
  sessionSets,
  setsFor,
  shortSession,
  TEMPLATES,
  trimSession,
  type PlanProfile,
  type SessionItem,
  type Where,
} from '../src/index';
import { loadGolden } from './helpers';
import { goldenCatalog, loadProto, rng } from './prototype-plan';

const catalog = goldenCatalog();
const { tags } = catalog;
const items = (names: readonly string[]): SessionItem[] => names.map((name) => ({ name }));
const tpl = (t: string): readonly string[] => TEMPLATES[t] as readonly string[];
const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name);

/** Template → home mapping → trim → focus, with no exclusions, swaps or history. */
function session(where: Where, t: string, focus: string[], profile: PlanProfile, timesDone = 0): string[] {
  const sessions = Object.fromEntries(Array.from({ length: timesDone }, (_, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, { t, n: 9 }]));
  const trimmed = trimSession(items(mapForWhere(tpl(t), where, catalog)), t, { profile, sessions });
  return names(applyFocus(trimmed, t, where, { profile, focus }, catalog));
}

describe('sessions: golden/sessions.json', () => {
  const golden = loadGolden<Record<string, string[]>>('sessions');
  // The fixture pins only 4 exercises, rotation offset 0: it does not record a profile, history or
  // exclusions. 45 minutes gives the 4-exercise cap; no sessions logged gives offset 0.
  const profile: PlanProfile = { minutes: 45 };

  it('has 18 cases', () => {
    expect(Object.keys(golden)).toHaveLength(18);
  });

  it.each(Object.entries(golden))('%s', (key, expected) => {
    const [where, t, f] = key.split('|') as [Where, string, string | undefined];
    const focus = f ? [f.replace('focus=', '')] : [];
    expect(session(where, t, focus, profile)).toEqual(expected);
  });
});

describe('mapForWhere (home mapping)', () => {
  it('leaves gym names alone', () => {
    expect(mapForWhere(tpl('Pull A'), 'gym', catalog)).toEqual(tpl('Pull A'));
  });

  it('drops null mappings and duplicates, keeping first place', () => {
    // Lateral Raise has no bodyweight version; both rows map to Backpack Row.
    expect(mapForWhere(tpl('Upper A'), 'bodyweight', catalog)).toEqual(['Push-ups', 'Backpack Row', 'Pike Push-ups', 'Bench Dips']);
    expect(mapForWhere(['Unknown Lift'], 'dumbbells', catalog)).toEqual(['Unknown Lift']);
  });
});

describe('trimSession', () => {
  const legs = items(tpl('Legs A'));
  const at = (n: number) => names(trimSession(legs, 'Legs A', { profile: { minutes: 45 }, sessions: Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${i}`, { t: 'Legs A', n: 5 }])) }));

  it('keeps the first 2 and rotates the extras by times done', () => {
    expect(at(0)).toEqual(['Hack Squat', 'Lying Leg Curl', 'Hip Thrust', 'Leg Extension']);
    expect(at(1)).toEqual(['Hack Squat', 'Lying Leg Curl', 'Standing Calf Raise', 'Cable Crunch']);
    expect(at(2)).toEqual(at(0));
  });

  it('wraps a pick past the end of the extras', () => {
    // 30 min: 1 slot over 4 extras; the 3rd time picks the 4th extra.
    const s = { profile: { minutes: 30 }, sessions: { a: { t: 'Legs A' }, b: { t: 'Legs A' }, c: { t: 'Legs A' } } };
    expect(names(trimSession(legs, 'Legs A', s))).toEqual(['Hack Squat', 'Lying Leg Curl', 'Cable Crunch']);
  });

  // Prototype quirk, pinned on purpose: the rotation counts every stored entry for the template,
  // including entries with no sets logged and the current day's own entry, so finishing today's
  // session moves today's preview to the next rotation. (trimSession takes no date, so the
  // same-day half is the caller's concern; this pins that an empty entry counts.)
  it('PINNED QUIRK: rotation counts empty entries', () => {
    const s = { profile: { minutes: 45 }, sessions: { '2026-10-07': { t: 'Legs A', n: 0 } } };
    expect(names(trimSession(legs, 'Legs A', s))).toEqual(at(1));
  });

  it('keeps a bridge only when its replacement stays', () => {
    const withBridge = [...legs.slice(0, 5), { name: 'Leg Press', bridge: true }];
    const repl = { 'Leg Press': { to: 'Hip Thrust' } };
    expect(names(trimSession(withBridge, 'Legs A', { profile: { minutes: 45 }, sessions: {}, repl }))).toContain('Leg Press');
    expect(names(trimSession(withBridge, 'Legs A', { profile: { minutes: 45 }, sessions: {}, repl: { 'Leg Press': { to: 'Standing Calf Raise' } } }))).not.toContain('Leg Press');
    expect(names(trimSession(withBridge, 'Legs A', { profile: { minutes: 45 }, sessions: {} }))).not.toContain('Leg Press');
  });

  it('returns short sessions unchanged', () => {
    expect(trimSession(legs, 'Legs A', { profile: { minutes: 90 }, sessions: {} })).toEqual(legs);
  });
});

describe('applyFocus', () => {
  it('ignores focus muscles the template does not train', () => {
    expect(muscleAllowed('Push A', 'glutes')).toBe(false);
    expect(muscleAllowed('Upper B', 'lats')).toBe(true);
    expect(muscleAllowed('Lower B', 'chest')).toBe(false);
    expect(muscleAllowed('Full body C', 'chest')).toBe(true);
    expect(muscleAllowed('Pull A', 'abs')).toBe(true);
  });

  it('adds an exercise for an untrained focus muscle and keeps within the cap', () => {
    const out = applyFocus(items(['Machine Chest Press', 'Incline Dumbbell Press', 'Seated Dumbbell Press', 'Lateral Raise']), 'Push A', 'gym', { profile: { minutes: 45 }, focus: ['abs'] }, catalog);
    const added = out.find((x) => x.focus);
    expect(added).toBeDefined();
    expect(tags[added?.name as string]?.primary).toContain('abs');
    expect(out).toHaveLength(4);
    expect(names(out).slice(0, 2)).toEqual(['Machine Chest Press', expect.any(String)]);
  });

  it('only counts the first 3 focus muscles', () => {
    expect(isFocus('Hip Thrust', ['chest', 'lats', 'abs', 'glutes'], tags)).toBe(false);
    expect(isFocus('Hip Thrust', ['glutes'], tags)).toBe(true);
    expect(isFocus('Not An Exercise', ['glutes'], tags)).toBe(false);
  });

  it('picks home-friendly, unexcluded exercises and none when nothing fits', () => {
    const p = focusPick('lats', new Set(), 'bodyweight', {}, catalog);
    expect(tags[p as string]?.equipment).toBe('bodyweight');
    expect(focusPick('lats', new Set(), 'gym', { isExcluded: () => true }, catalog)).toBeNull();
    expect(applyFocus(items(['Push-ups']), 'Pull A', 'bodyweight', { focus: ['forearms'], isExcluded: () => true }, catalog)).toEqual(items(['Push-ups']));
  });
});

describe('shortSession', () => {
  const six = [...items(tpl('Legs A')).slice(0, 5), { name: 'Leg Press', bridge: true }];
  it('cuts to 3 for 30 min and 4 for 45, dropping bridges', () => {
    expect(names(shortSession(six, '30'))).toEqual(['Hack Squat', 'Lying Leg Curl', 'Hip Thrust']);
    expect(shortSession(six, '45')).toHaveLength(4);
    expect(shortSession(six, 'usual')).toEqual(six);
    expect(shortSession(six, undefined)).toEqual(six);
  });
});

describe('sessionSets', () => {
  const date = '2026-10-08';
  const legs = items(['Hack Squat', 'Hip Thrust', 'Standing Calf Raise']);

  it('defaults to 3 sets, calf raises 4', () => {
    expect(sessionSets(legs, { date, tags })).toEqual([
      { name: 'Hack Squat', sets: 3 },
      { name: 'Hip Thrust', sets: 3 },
      { name: 'Standing Calf Raise', sets: 4 },
    ]);
    expect(setsFor('Seated Calf Raise', 3, null, date, tags)).toBe(4);
    expect(setsFor('Seated Calf Raise', 5, null, date, tags)).toBe(5);
  });

  it('beginner 2-set ramp for the first 14 days, calves included', () => {
    const fresh: PlanProfile = { exp: 'new', created: '2026-09-25' }; // day 13
    expect(sessionSets(legs, { date, tags, profile: fresh }).map((e) => e.sets)).toEqual([2, 2, 2]);
    expect(sessionSets(legs, { date, tags, profile: { exp: 'new', created: '2026-09-24' } }).map((e) => e.sets)).toEqual([3, 3, 4]);
    expect(sessionSets(legs, { date, tags, profile: { exp: 'some', created: '2026-10-01' } }).map((e) => e.sets)).toEqual([3, 3, 4]);
    expect(sessionSets(legs, { date, tags, profile: { exp: 'new' } }).map((e) => e.sets)).toEqual([3, 3, 4]);
  });

  it('focus adds 1 set, at most 5', () => {
    expect(sessionSets(legs, { date, tags, focus: ['glutes', 'calves'] }).map((e) => e.sets)).toEqual([4, 4, 5]);
    expect(sessionSets(legs, { date, tags, focus: ['glutes'], lastSets: () => 5 }).map((e) => e.sets)).toEqual([5, 5, 5]);
    expect(sessionSets(legs, { date, tags, focus: ['glutes'], profile: { exp: 'new', created: date } }).map((e) => e.sets)).toEqual([3, 3, 2]);
  });

  it('starts from last time’s sets, at least 3', () => {
    expect(sessionSets(legs, { date, tags, lastSets: (n) => (n === 'Hack Squat' ? 4 : 1) }).map((e) => e.sets)).toEqual([4, 3, 4]);
  });

  it('bridges get 2 sets', () => {
    expect(sessionSets([{ name: 'Leg Press', bridge: true }], { date, tags })).toEqual([{ name: 'Leg Press', sets: 2, bridge: true }]);
  });

  it('deload keeps ~60% (min 2); light drops one set above 2', () => {
    expect(sessionSets(legs, { date, tags, deload: true, light: true }).map((e) => e.sets)).toEqual([2, 2, 3]);
    expect(sessionSets(legs, { date, tags, light: true }).map((e) => e.sets)).toEqual([2, 2, 3]);
    expect(sessionSets(legs, { date, tags, light: true, profile: { exp: 'new', created: date } }).map((e) => e.sets)).toEqual([2, 2, 2]);
  });

  it('adds the balance exercise with 2 sets at 60+, once', () => {
    const out = sessionSets(legs, { date, tags, profile: { age: 60 } });
    expect(out.at(-1)).toEqual({ name: BALANCE_EXERCISE, sets: 2 });
    expect(sessionSets(legs, { date, tags, profile: { age: 59 } }).some((e) => e.name === BALANCE_EXERCISE)).toBe(false);
    const already = sessionSets(items([BALANCE_EXERCISE]), { date, tags, profile: { age: 70 } });
    expect(already).toEqual([{ name: BALANCE_EXERCISE, sets: 3 }]);
  });
});

describe('session building: differential against the prototype buildSession', () => {
  const proto = loadProto();
  const r = rng(1919);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const some = <T>(xs: readonly T[], p: number): T[] => xs.filter(() => r() < p);
  const tagNames = Object.keys(tags);
  const muscles = ['chest', 'lats', 'upper-back', 'side-delt', 'rear-delt', 'front-delt', 'biceps', 'triceps', 'forearms', 'quads', 'hams', 'glutes', 'calves', 'abs', 'lower-back'];
  const templateNames = Object.keys(TEMPLATES);
  const date = '2026-10-08';
  const inRange = (x?: { until: string; from?: string }) => !!x && x.until >= date && (!x.from || x.from <= date);

  it('mapForWhere matches for every template and place', () => {
    for (const t of templateNames)
      for (const where of ['gym', 'dumbbells', 'bodyweight'] as const)
        expect(mapForWhere(tpl(t), where, catalog)).toEqual(proto.mapForWhere([...tpl(t)], where));
  });

  it('matches on 4,000 random states', () => {
    const mismatches: unknown[] = [];
    for (let k = 0; k < 4000; k++) {
      const t = pick(templateNames);
      const profile: PlanProfile = {
        minutes: pick([30, 45, 60, 75, 90, null]),
        exp: pick(['new', 'some', 'exp'] as const),
        created: pick(['2026-10-01', '2026-09-01', null]),
        age: pick([25, 59, 60, 75]),
        where: pick(['gym', 'dumbbells', 'bodyweight'] as const),
      };
      const focus = some(muscles, 0.15);
      const lifts = Object.fromEntries(some(tagNames, 0.1).map((n) => [n, {}]));
      const excl = some(tagNames, 0.05);
      const repl: Record<string, { to: string; bridgeUntil?: string }> = {};
      for (const n of some(tpl(t), 0.15)) repl[n] = { to: pick(tagNames), bridgeUntil: pick(['2026-10-20', '2026-10-01']) };
      const sessions = Object.fromEntries(Array.from({ length: Math.floor(r() * 6) }, (_, i) => [`2026-09-${10 + i}`, { t: pick([t, 'Push A']), n: pick([0, 6]) }]));
      const workout = { where: pick([undefined, 'gym', 'dumbbells', 'bodyweight'] as const), checkin: { time: pick([undefined, 'usual', '45', '30']) }, ciChoice: pick([undefined, 'light']) };
      const adj = { deload: pick([undefined, { until: '2026-10-10' }, { until: '2026-10-01' }]), reentry: pick([undefined, { until: '2026-10-10', pct: 0.15 }, { until: '2026-10-10', pct: 0.3 }]) };
      const clearance = r() < 0.2;
      const last = Object.fromEntries(some(tagNames, 0.2).map((n) => [n, pick([1, 3, 4, 5, 6])]));
      Object.assign(proto.S, { date, settings: { profile, focus, excl, repl, adj }, sessions: { entries: sessions }, lifts, day: { workout: { ...workout } }, last, clearance });

      // Port pipeline. resolveSession (exclusions and swaps) is not ported yet, so both sides use the prototype's.
      const where: Where = workout.where || profile.where || 'gym';
      const resolved = proto.resolveSession(mapForWhere(tpl(t), where, catalog), where);
      expect(trimSession(resolved, t, { profile, sessions, repl })).toEqual(proto.trimSession(resolved, t));
      let its = trimSession(resolved, t, { profile, sessions, repl });
      const focusState = { profile, focus, lifts, isExcluded: (n: string) => excl.includes(n) };
      expect(applyFocus(its, t, where, focusState, catalog)).toEqual(proto.applyFocus(its, t, where));
      its = shortSession(applyFocus(its, t, where, focusState, catalog), workout.checkin.time);
      const reentry = inRange(adj.reentry) ? (adj.reentry?.pct ?? 0) : 0;
      const ours = sessionSets(its, {
        profile,
        date,
        focus,
        tags,
        lastSets: (n) => last[n],
        deload: inRange(adj.deload),
        light: workout.ciChoice === 'light' || reentry >= 0.3 || clearance,
      });

      proto.buildSession(t);
      const theirs = (proto.S.day.workout['exercises'] as { name: string; sets: unknown[]; bridge?: true }[]).map((e) => ({ name: e.name, sets: e.sets.length, ...(e.bridge ? { bridge: e.bridge } : {}) }));
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) mismatches.push({ t, profile, focus, ours, theirs });
    }
    expect(mismatches).toEqual([]);
  });
});
