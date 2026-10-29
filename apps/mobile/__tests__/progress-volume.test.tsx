import { Dimensions } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { COVER_SHOW, addDays, round1, doneCoverage, plannedCoverage, volumeVsPlan, weeklyDoneSets, type VolumeVsPlan } from '@plate-and-bar/core';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { SyncContext } from '../src/sync/SyncProvider';
import { VolumeSection } from '../src/progress/VolumeSection';
import { loadVolumeInputs, volumeFrom } from '../src/progress/volumeRead';
import { defaultMuscle, noVolumeYet, rankRows, volumeBars } from '../src/progress/volumeView';
import { VOL_EMPTY, VOL_ERROR, VOL_NO_FULL_WEEK, VOL_NO_SETUP, VOL_PLAN_LINE } from '../src/progress/copy';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { getCatalog } from '../src/workout/catalog';
import { muscleName } from '../src/workout/copy';
import { dayWrites } from '../src/workout/dayQueue';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { openDb } from './sync-helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
const focusFns: (() => void)[] = [];
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      focusFns.push(cb);
      cb();
      return () => void focusFns.splice(focusFns.indexOf(cb), 1);
    }, [cb]);
  },
}));
const focus = () => act(async () => { focusFns.forEach((f) => f()); });

/** Friday 2026-10-30: the viewed week starts Monday 10-26; the last complete week is 10-19 to 10-25. */
const TODAY = '2026-10-30';
const meta = { version: 0, updated_at: '', deleted_at: null };
const wset = (id: string, exercise: string, o: Partial<WorkoutSet> = {}): WorkoutSet => ({ ...meta, id, workout_id: null, exercise, kind: 'work', set_index: 0, weight_kg: 60, reps: 8, done: true, rate: null, t: null, ...o });
type Db = Awaited<ReturnType<typeof openDb>>;
let n = 0;
/** One logged day: a workout of `exercises` with `done` ticked work sets each (plus an unticked one, a ramp and a deleted one that must not count). */
async function train(db: Db, date: string, exercises: Record<string, number>, w: Partial<Workout> = {}) {
  await saveWorkout(db, { ...meta, id: null, date, template: null, base: null, where: 'gym', cardio_min: null, mods: {}, exercises: Object.keys(exercises).map((name) => ({ name })), ci_choice: null, ...w } as unknown as Workout);
  for (const [name, done] of Object.entries(exercises)) {
    for (let i = 0; i < done; i++) await saveSet(db, date, wset(`s${n++}`, name));
    await saveSet(db, date, wset(`s${n++}`, name, { done: false }));
    await saveSet(db, date, wset(`s${n++}`, name, { kind: 'ramp' }));
    await saveSet(db, date, wset(`s${n++}`, name, { deleted_at: '2026-10-01T00:00:00Z' }));
  }
}
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '80', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const planned = plannedCoverage({ date: TODAY, profile }, getCatalog());
const chestPlan = round1(planned['chest'] ?? 0);

/** Twelve weeks: chest 3 sets a week at first, back 6 a week, nothing for legs. */
async function history(db: Db, weeksBack = 12) {
  for (let w = weeksBack; w >= 1; w--) {
    const monday = addDays('2026-10-26', -7 * w);
    await train(db, monday, { 'Barbell Bench Press': 3, 'Lat Pulldown': 6 });
  }
  await train(db, '2026-10-26', { 'Barbell Bench Press': 5 }); // this week so far
}

interface Over { focus?: string[]; profile?: typeof profile | null; date?: string; version?: number }
function view(db: Db, o: Over = {}) {
  const settings = { ...defaultSettings('2026-01-01T00:00:00Z'), focus: o.focus ?? [] };
  const ui = (version: number) => (
    <SyncContext.Provider value={{ dataVersion: version } as never}>
      <VolumeSection db={db} date={o.date ?? TODAY} today={TODAY} profile={o.profile === undefined ? profile : o.profile} settings={settings} />
    </SyncContext.Provider>
  );
  return { ui };
}
const show = async (db: Db, o: Over = {}) => {
  const v = view(db, o);
  const r = await render(v.ui(o.version ?? 0));
  return { ...r, v };
};
const chip = (name: string) => screen.getByRole('button', { name });
const pressedOf = (name: string) => chip(name).props.accessibilityState.selected;
const hidden = { includeHiddenElements: true } as const;

beforeEach(() => { n = 0; });

describe('loadVolumeInputs', () => {
  it('matches doneCoverage for the last complete week, in two range reads plus since (not a read per day)', async () => {
    const db = await openDb();
    await history(db);
    await train(db, '2026-10-21', { 'Dumbbell Curl': 2 }, { deleted_at: '2026-10-22T00:00:00Z' }); // a deleted workout counts nothing
    await train(db, '2026-07-01', { 'Dumbbell Curl': 2 }, { deleted_at: '2026-07-02T00:00:00Z' });
    const spy = jest.spyOn(db, 'getAllAsync');
    const { days, since } = await loadVolumeInputs(db, TODAY, 12);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(since).toBe('2026-08-03'); // the deleted workout does not move it
    const week = weeklyDoneSets(days, TODAY, 12, getCatalog().tags).find((w) => w.week === '2026-10-19')!;
    const done = doneCoverage('2026-10-25', days, getCatalog().tags);
    for (const m of COVER_SHOW) expect(week.sets[m]).toBe(done[m] ?? 0);
    expect(week.sets['chest']).toBe(3);
    expect(week.sets['lats']).toBe(6);
    expect(week.sets['biceps']).toBe(3); // Lat Pulldown: biceps are secondary, half a set each
  });

  it('reads from the first Monday of the 12 weeks and not past the viewed week', async () => {
    const db = await openDb();
    await train(db, addDays(volumeFrom(TODAY, 12), -1), { 'Barbell Bench Press': 3 });
    await train(db, volumeFrom(TODAY, 12), { 'Barbell Bench Press': 3 });
    await train(db, '2026-11-02', { 'Barbell Bench Press': 3 }); // next week
    const { days, since } = await loadVolumeInputs(db, TODAY, 12);
    expect(volumeFrom(TODAY, 12)).toBe('2026-08-10');
    expect(days.map((d) => d.date)).toEqual(['2026-08-10']);
    expect(since).toBe('2026-08-09'); // the whole history, not the window
  });

  it('has no since without a workout', async () => {
    expect((await loadVolumeInputs(await openDb(), TODAY, 12)).since).toBeNull();
  });
});

describe('volumeView', () => {
  const row = (muscle: string, avg: number, target: number): VolumeVsPlan => ({ muscle, avg, target, gap: avg - target, below: target > 0 && avg < target, low: avg < 6, barPct: Math.min(100, (avg / 12) * 100) });
  it('defaults to the first focus muscle that the meter shows', () => {
    const rows = [row('chest', 5, 10), row('lats', 1, 10)];
    expect(defaultMuscle(['front-delt', 'quads', 'lats'], rows)).toBe('quads');
    expect(defaultMuscle([], rows)).toBe('lats');
  });
  it('without focus picks the furthest below target, the first on a tie, and the lowest average with no targets', () => {
    expect(defaultMuscle([], [row('chest', 8, 10), row('lats', 2, 10), row('quads', 2, 10)])).toBe('lats');
    expect(defaultMuscle([], [row('chest', 9, 0), row('lats', 3, 0)])).toBe('lats');
    expect(defaultMuscle([], [])).toBe('chest');
  });
  it('ranks below-plan rows by gap, then low rows, then the rest by average', () => {
    const rows = [row('a', 14, 10), row('b', 2, 0), row('c', 9, 12), row('d', 4, 12), row('e', 8, 0)];
    expect(rankRows(rows).map((r) => r.muscle)).toEqual(['d', 'c', 'b', 'e', 'a']);
  });
  it('bars are gaps before the first workout and hollow in the week in progress', () => {
    const weeks = weeklyDoneSets([], TODAY, 3, getCatalog().tags);
    const bars = volumeBars(weeks, 'chest', '2026-10-21');
    expect(bars.map((b) => b.value)).toEqual([null, 0, 0]); // 10-12 week ended 10-18, before 10-21; 10-19 week holds it
    expect(bars.map((b) => b.partial)).toEqual([undefined, undefined, true]);
    expect(volumeBars(weeks, 'chest', null).every((b) => b.value === null)).toBe(true);
  });
  it('noVolumeYet: no workout, or workouts with nothing ticked inside the window', () => {
    const weeks = weeklyDoneSets([], TODAY, 12, getCatalog().tags);
    expect(noVolumeYet(weeks, null)).toBe(true);
    expect(noVolumeYet(weeks, '2026-10-01')).toBe(true);
    expect(noVolumeYet(weeks, '2025-01-01')).toBe(false); // older history: zeros are real
  });
});

describe('VolumeSection', () => {
  it('the focus muscle leads', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['quads'] });
    await screen.findByRole('button', { name: 'Quads' });
    expect(pressedOf('Quads')).toBe(true);
    expect(pressedOf('Chest')).toBe(false);
  });

  it('loading: a skeleton and no chips or numbers until the read finishes', async () => {
    const db = await openDb();
    await history(db);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => { open = r; });
    const real = db.getAllAsync.bind(db);
    jest.spyOn(db, 'getAllAsync').mockImplementation((async (...a: Parameters<typeof real>) => {
      await gate;
      return real(...a);
    }) as never);
    await show(db, { focus: ['chest'] });
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chest' })).toBeNull();
    expect(screen.queryByText(VOL_ERROR)).toBeNull();
    expect(screen.queryByText(VOL_EMPTY)).toBeNull();
    await act(async () => open());
    await screen.findByRole('button', { name: 'Chest' });
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });

  it('without focus starts on the muscle furthest below its plan', async () => {
    const db = await openDb();
    await history(db); // only chest, back and arms have sets: legs and abs are 0 of a plan
    await show(db);
    await waitFor(() => expect(screen.queryByTestId('skeleton')).toBeNull());
    const rows = volumeVsPlan(weeklyDoneSets((await loadVolumeInputs(db, TODAY, 12)).days, TODAY, 12, getCatalog().tags), planned, '2026-08-03').rows;
    const expected = defaultMuscle([], rows);
    const label = expected.charAt(0).toUpperCase() + expected.slice(1);
    expect(screen.getAllByRole('button').filter((b) => b.props.accessibilityState?.selected).map((b) => b.props.accessibilityLabel)).toEqual([expect.stringContaining(label.split('-')[0]!)]);
  });

  it('switching chips changes the muscle, headline and chart', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['chest'] });
    await screen.findByText(`Chest 5 of about ${chestPlan} sets this week`, hidden);
    expect(pressedOf('Chest')).toBe(true);
    await fireEvent.press(chip('Lats'));
    expect(pressedOf('Lats')).toBe(true);
    expect(pressedOf('Chest')).toBe(false);
    expect(screen.getByText(/^Lats 0 of about [\d.]+ sets this week$/, hidden)).toBeTruthy(); // lats: nothing yet this week
    expect(screen.getByLabelText(/^Lats: done sets by week\./, hidden)).toBeTruthy();
    expect(screen.queryByText(/^Chest 5/, hidden)).toBeNull();
  });

  it('labels the line as the current plan and never calls it a past target', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['chest'] });
    await screen.findByText(VOL_PLAN_LINE(String(chestPlan)));
    expect(screen.getByText(/Earlier weeks may have followed a different plan/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getAllByText(new RegExp(`^Your current plan: ${chestPlan} sets`)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Below your current plan$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Target/i)).toBeNull();
    expect(screen.queryByText(/Below target/)).toBeNull();
    expect(screen.getByLabelText(/below your current plan/, hidden)).toBeTruthy(); // the spoken count
  });

  it('headline says the week of a past viewed date and drops "about" without a plan line', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['chest'], date: '2026-10-21' });
    await screen.findByText(new RegExp(`^Chest 3 of about ${chestPlan} sets in the week of 19 Oct$`), hidden);
  });

  it('empty: no workout yet', async () => {
    const db = await openDb();
    await show(db);
    await screen.findByText(VOL_EMPTY);
    expect(screen.queryByRole('button', { name: 'Chest' })).toBeNull();
  });

  it('empty: workouts exist but nothing was ticked', async () => {
    const db = await openDb();
    await train(db, '2026-10-26', {}); // a session opened, no sets
    await show(db);
    await screen.findByText(VOL_EMPTY);
  });

  it('error: no stale numbers, and the next focus after a write tries again', async () => {
    const db = await openDb();
    await history(db);
    const real = db.getAllAsync.bind(db);
    const spy = jest.spyOn(db, 'getAllAsync').mockRejectedValue(new Error('disk'));
    await show(db, { focus: ['chest'] });
    await screen.findByText(VOL_ERROR);
    expect(screen.queryByText(/^Chest/, hidden)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chest' })).toBeNull();
    spy.mockImplementation(real as never);
    dayWrites.current++;
    await focus();
    await screen.findByText(/^Chest 5 of/, hidden);
    expect(screen.queryByText(VOL_ERROR)).toBeNull();
  });

  it('no plan: without a profile there is no line and the setup hint shows', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['chest'], profile: null });
    await screen.findByText('Chest 5 sets this week', hidden);
    expect(screen.getByText(VOL_NO_SETUP)).toBeTruthy();
    expect(screen.queryByText(/Your current plan/)).toBeNull();
  });

  it('no target for the chosen muscle: chart without a line and a plain headline', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['calves'] });
    await screen.findByRole('button', { name: 'Calves' });
    const target = planned['calves'] || 0;
    if (target === 0) {
      expect(screen.getByText(/Your current plan has no sets for calves/)).toBeTruthy();
      expect(screen.getByText('Calves 0 sets this week', hidden)).toBeTruthy();
    } else expect(screen.getByText(VOL_PLAN_LINE(String(round1(target))))).toBeTruthy();
  });

  it('a new user: no complete week gives no averages; one gives a note that it settles after 4', async () => {
    const db = await openDb();
    await train(db, '2026-10-27', { 'Barbell Bench Press': 3 }); // the first workout is this week
    await show(db, { focus: ['chest'] });
    await screen.findByText(VOL_NO_FULL_WEEK);
    expect(screen.queryByText('Show all')).toBeNull();
    const db2 = await openDb();
    await train(db2, '2026-10-12', { 'Barbell Bench Press': 3 }); // Monday of week 1: three complete weeks follow (10-12, 10-19... 10-26 is current)
    await show(db2, { focus: ['chest'] });
    await screen.findByText(/Average of your 2 complete weeks so far; it settles after 4/);
  });

  it('a full history averages 4 complete weeks', async () => {
    const db = await openDb();
    await history(db);
    await show(db, { focus: ['chest'] });
    await screen.findByText(/^Average of your last 4 complete weeks/);
  });

  describe('ranked list', () => {
    let win: jest.SpyInstance;
    beforeEach(() => { win = jest.spyOn(Dimensions, 'get'); });
    afterEach(() => win.mockRestore());
    const at = (width: number) => win.mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 });

    it('shows the 3 lowest at 375 and all 12 after Show all, then fewer', async () => {
      at(375);
      const db = await openDb();
      await history(db);
      await show(db, { focus: ['chest'] });
      await screen.findByText(/^Average of your last 4/);
      const rows = () => screen.getAllByLabelText(/, average .* sets a week/);
      expect(rows()).toHaveLength(3);
      const rows12 = volumeVsPlan(weeklyDoneSets((await loadVolumeInputs(db, TODAY, 12)).days, TODAY, 12, getCatalog().tags), planned, '2026-08-03').rows;
      const lowest = rankRows(rows12).slice(0, 3).map((r) => muscleName(r.muscle));
      expect(rows().map((r) => String(r.props.accessibilityLabel).split(',')[0]!.toLowerCase())).toEqual(lowest);
      const btn = screen.getByRole('button', { name: 'Show all' });
      await fireEvent.press(btn);
      expect(rows()).toHaveLength(12);
      expect(screen.getByRole('button', { name: 'Show fewer' }).props.accessibilityState.expanded).toBe(true);
      await fireEvent.press(screen.getByRole('button', { name: 'Show fewer' }));
      expect(rows()).toHaveLength(3);
    });

    it('a muscle with sets under the plan is marked below and a thin one low, in words', async () => {
      at(375);
      const db = await openDb();
      await history(db);
      await show(db, { focus: ['chest'] });
      await screen.findByText(/^Average of your last 4/);
      const first = screen.getAllByLabelText(/, average .* sets a week/)[0]!;
      expect(String(first.props.accessibilityLabel)).toMatch(/below your plan, low$/);
      expect(screen.getAllByText('Low').length).toBeGreaterThan(0);
    });

    it('lists everything at 1280 with no Show all', async () => {
      at(1280);
      const db = await openDb();
      await history(db);
      await show(db, { focus: ['chest'] });
      await screen.findByText(/^Average of your last 4/);
      expect(screen.getAllByLabelText(/, average .* sets a week/)).toHaveLength(12);
      expect(screen.queryByText('Show all')).toBeNull();
    });
  });

  describe('reloads', () => {
    it('a dataVersion bump reads again and shows the new sets; the old ones stay while it reads', async () => {
      const db = await openDb();
      await history(db);
      const { v, rerender } = await show(db, { focus: ['chest'] });
      await screen.findByText(/^Chest 5 of/, hidden);
      await train(db, '2026-10-27', { 'Barbell Bench Press': 2 });
      await rerender(v.ui(1));
      await screen.findByText(/^Chest 7 of/, hidden);
    });

    it('a focus reads only after a local write', async () => {
      const db = await openDb();
      await history(db);
      await show(db, { focus: ['chest'] });
      await screen.findByText(/^Chest 5 of/, hidden);
      const spy = jest.spyOn(db, 'getAllAsync');
      await focus();
      expect(spy).not.toHaveBeenCalled();
      await train(db, '2026-10-27', { 'Barbell Bench Press': 1 });
      dayWrites.current++;
      await focus();
      await screen.findByText(/^Chest 6 of/, hidden);
    });

    it('moving within the viewed week does not read; moving to another week does, and shows loading, not the old week', async () => {
      const db = await openDb();
      await history(db);
      const { v, rerender } = await show(db, { focus: ['chest'] });
      await screen.findByText(/^Chest 5 of/, hidden);
      const real = db.getAllAsync.bind(db);
      const spy = jest.spyOn(db, 'getAllAsync');
      const same = view(db, { focus: ['chest'], date: '2026-10-28' });
      await rerender(same.ui(0));
      expect(spy).not.toHaveBeenCalled();
      void v;
      const other = view(db, { focus: ['chest'], date: '2026-10-21' });
      let open: () => void = () => undefined;
      const gate = new Promise<void>((r) => { open = r; });
      spy.mockImplementation((async (...a: Parameters<typeof real>) => {
        await gate;
        return real(...a);
      }) as never);
      await rerender(other.ui(0));
      expect(screen.getByTestId('skeleton')).toBeTruthy(); // the read is pending: the old week is not shown
      expect(screen.queryByText(/^Chest 5 of/, hidden)).toBeNull();
      await act(async () => open());
      await screen.findByText(/in the week of 19 Oct/, hidden);
      expect(spy).toHaveBeenCalled();
    });
  });
});
