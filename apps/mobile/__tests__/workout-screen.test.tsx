import { AccessibilityInfo, Platform, StyleSheet, Vibration } from 'react-native';
import { expand, press, pressDay, tickFirstSets } from './disclosure-helpers';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { saveWeight } from '../src/db/progress';
import { defaultSettings } from '../src/settings/types';
import { loadSessionLog, saveSet } from '../src/db/workouts';
import { setRecord, blankRow, type ExState } from '../src/workout/model';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { getCatalog } from '../src/workout/catalog';
import { HAND_PICKED } from '@plate-and-bar/core';
import type { ExType, LiftRecord } from '@plate-and-bar/core';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// Thursday 2026-10-08: the 6-day plan gives Push B (Barbell Bench Press, Machine Shoulder Press, Pec Deck Fly,
// Cable Lateral Raise, Overhead Cable Extension).
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const SUNDAY = () => new Date(2026, 9, 11, 10, 0, 0);
const DATE = '2026-10-08';
const PUSH_B = ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension'];

function profile() {
  return buildProfile(
    {
      ...emptyDraft(),
      sex: 'male',
      age: '30',
      unit: 'cm',
      cm: '165',
      weight: '82',
      activity: 'sitting',
      where: 'gym',
      days: 6,
      exp: 'some',
      minutes: 60,
      goal: 'lose',
      pace: 'moderate',
      screen: ['no', 'no', 'no', 'no', 'no', 'no'],
    },
    new Date(2026, 8, 1),
  );
}

type Db = ReturnType<typeof memoryDb>;

async function setup(opts: { now?: () => Date; lifts?: Record<string, number>; hist?: Record<string, number[]>; focus?: string[]; restOff?: boolean; overrides?: Record<string, { type: ExType; step_kg: number; rep_low: number; rep_high: number }>; where?: 'gym' | 'dumbbells'; weightKg?: number; weighIns?: { date: string; weight_kg: number }[] } = {}) {
  const db = memoryDb();
  if (opts.focus || opts.restOff || opts.overrides) await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), focus: opts.focus ?? [], rest_off: !!opts.restOff, exercise_overrides: opts.overrides ?? {} });
  await saveProfile(db, { ...profile(), where: opts.where ?? 'gym', ...(opts.weightKg === undefined ? {} : { weight_kg: opts.weightKg }) });
  for (const w of opts.weighIns ?? []) await saveWeight(db, { id: null, version: 0, updated_at: '2026-10-08T00:00:00Z', deleted_at: null, ...w });
  for (const [name, w] of Object.entries(opts.lifts ?? {})) await seedLift(db, name, w, opts.hist?.[name]);
  await mount(db, opts);
  return db;
}

async function mount(db: Db, opts: { now?: () => Date } = {}) {
  await render(withProfile(db, <WorkoutScreen db={db} now={opts.now ?? THURSDAY} />));
}

/** A previous session in core's lift record shape: 3 sets at the top of the range, so the suggestion is one step up. */
async function seedLift(db: Db, name: string, w: number, scores?: number[]) {
  const set = { w, r: getCatalog().meta[name]?.rep_high ?? 12, rate: 'right' as const };
  const rec: LiftRecord = {
    date: '2026-10-05',
    sets: [set, set, set],
    form: 'yes',
    n: 2,
    first: '2026-09-20',
    prev: null,
    hist: (scores ?? [Math.round(w * (1 + set.r / 30) * 10) / 10]).map((e, i) => ({ date: `2026-09-${20 + i}`, e })),
    pbToast: null,
  };
  db.rows.set(`lift_stats:${name}`, JSON.stringify(rec));
}

/** Lets everything already queued run: promise callbacks, then one macrotask turn. No wall-clock delay. */
const flush = () => act(async () => { await new Promise<void>((r) => setImmediate(r)); });

/** The "Guide and tools" disclosure is closed except on an exercise's very first session. */
const openGuide = async (name: string) => {
  const b = screen.getByLabelText(`Guide and tools for ${name}`);
  if (!b.props.accessibilityState?.expanded) await fireEvent.press(b);
};
const stored = <T,>(db: Db, key: string) => JSON.parse(db.rows.get(key) as string) as T;
const storedSets = (db: Db) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);
const placeholder = (label: string) => screen.getByLabelText(label).props.placeholder as string;
/** The rest countdown reads the wall clock, so a test that checks its text freezes the clock first (#270): the text must not depend on how long the machine took. */
const frozenClock = () => jest.spyOn(Date, 'now').mockReturnValue(Date.now());

// A test that waits on a slow write or read, or on a toast, runs on a fake clock: findBy*/waitFor timeouts and toast timers then
// count test steps, not machine time, so they cannot expire while a loaded machine is busy. Microtasks and setImmediate stay real.
let fake = false;
const fakeClock = () => {
  fake = true;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
};
// Run what is still pending first, so an error thrown from a timer (e.g. SettingsProvider's rethrow) fails the test instead of being dropped.
afterEach(() => {
  if (fake) jest.runOnlyPendingTimers();
  fake = false;
  jest.useRealTimers();
});

describe('Workout tab: preview and Start', () => {
  it('shows today’s planned session from core with a Start button', async () => {
    await setup();
    expect(await screen.findByText('Push B day')).toBeTruthy();
    PUSH_B.forEach((n, i) => expect(screen.getByLabelText(`Exercise ${i + 1}: ${n}`)).toBeTruthy());
    expect(screen.getByLabelText('Start Push B')).toBeTruthy();
    expect(screen.getByText(/5 exercises, 3 sets each, sized to your 60-minute sessions/)).toBeTruthy();
  });

  it('shows a rest day on Sunday, with the other templates to start anyway', async () => {
    await setup({ now: SUNDAY });
    expect(await screen.findByText('Rest day')).toBeTruthy();
    expect(screen.queryByLabelText('Exercise 1: Barbell Bench Press')).toBeNull();
    expect(screen.getByLabelText('Choose Pull A')).toBeTruthy();
  });

  it('Start stores the Workout and its sets in the contract shapes', async () => {
    const db = await setup();
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');

    const w = stored<Workout>(db, `workouts:${DATE}`);
    expect(Object.keys(w).sort()).toEqual(['base', 'cardio_min', 'ci_choice', 'date', 'deleted_at', 'exercises', 'id', 'mods', 'template', 'updated_at', 'version', 'where']);
    expect(w).toMatchObject({ id: null, version: 0, deleted_at: null, date: DATE, template: 'Push B', base: 'Push B', where: null, cardio_min: null, ci_choice: null });
    expect(w.exercises).toEqual(PUSH_B.map((name) => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false })));
    expect(w.mods).toMatchObject({ light: false, short: false, where: 'gym' });

    const sets = storedSets(db);
    expect(sets).toHaveLength(15);
    const s = sets.find((x) => x.exercise === 'Barbell Bench Press' && x.set_index === 1) as WorkoutSet;
    expect(Object.keys(s).sort()).toEqual(['deleted_at', 'done', 'exercise', 'id', 'kind', 'rate', 'reps', 'set_index', 't', 'updated_at', 'version', 'weight_kg', 'workout_id']);
    expect(s).toMatchObject({ workout_id: null, kind: 'work', weight_kg: null, reps: null, done: false, rate: null, t: null, deleted_at: null, version: 0 });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the where chips change today\u2019s preview and Start stores the override', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Training away from your gym?');
    await press('Dumbbells only');
    expect(screen.getByLabelText('Training with dumbbells only today')).toBeTruthy();
    expect(screen.queryByText(/Cable Lateral Raise/)).toBeNull();
    await press('Start Push B');
    await screen.findByText('Push B (dumbbells only)');
    const w = stored<Workout>(db, `workouts:${DATE}`);
    expect(w).toMatchObject({ where: 'dumbbells', base: 'Push B', template: 'Push B (dumbbells only)' });
    expect(w.mods).toMatchObject({ where: 'dumbbells' });
  });

  it('picking the profile\u2019s own where keeps the override empty', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Training away from your gym?');
    await press('Normal gym');
    await press('Start Push B');
    await screen.findByText('Push B');
    expect(stored<Workout>(db, `workouts:${DATE}`).where).toBeNull();
  });

  it('marks the chosen where chip as pressed', async () => {
    await setup();
    await screen.findByText('Push B day');
    await press('Training away from your gym?');
    expect(screen.getByLabelText('Normal gym').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Dumbbells only').props['aria-pressed']).toBe(false);
    await press('Dumbbells only');
    await press('Training with dumbbells only today');
    expect(screen.getByLabelText('Dumbbells only').props['aria-pressed']).toBe(true);
    expect(screen.getByLabelText('Normal gym').props['aria-pressed']).toBe(false);
  });

  it('an Add tapped while the Start save is slow is kept and applied once the save is done (#864)', async () => {
    fakeClock();
    const db = await setup();
    await screen.findByText('Push B day');
    const real = db.runAsync.bind(db);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    db.runAsync = (async (sql: string, ...args: (string | number)[]) => {
      if (/INTO workouts/.test(sql)) await gate;
      return real(sql, ...args);
    }) as typeof db.runAsync;
    await press('Start Push B');
    await screen.findByText('Push B');
    // The screen offers a second session once every exercise has a done set; the save is still held.
    const first = await tickFirstSets();
    await press('Training again later today?');
    await press('Add Pull B');
    expect(db.rows.get(`workouts:${DATE}`)).toBeUndefined(); // Start is still saving
    release();
    expect(await screen.findByText('Pull B added to today')).toBeTruthy();
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises.length).toBe(first + 5));
  });

  it('an Add tapped while the Start save fails is dropped and the failure toast stays (#864)', async () => {
    fakeClock();
    const db = await setup();
    await screen.findByText('Push B day');
    const real = db.runAsync.bind(db);
    let release: () => void = () => {};
    let failed = false;
    const gate = new Promise<void>((r) => (release = r));
    db.runAsync = (async (sql: string, ...args: (string | number)[]) => {
      if (/INTO workouts/.test(sql) && !failed) {
        failed = true; // only Start's write fails; a later write would go through
        await gate;
        throw new Error('disk full');
      }
      return real(sql, ...args);
    }) as typeof db.runAsync;
    await press('Start Push B');
    await screen.findByText('Push B');
    // The screen offers a second session once every exercise has a done set; the save is still held.
    const first = await tickFirstSets();
    await press('Training again later today?');
    await press('Add Pull B');
    expect(db.rows.get(`workouts:${DATE}`)).toBeUndefined(); // Start is still saving
    release();
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByText('Pull B added to today')).toBeNull();
    // No Pull B exercises in storage (the done-set taps above are saved on their own, after the failed Start).
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises.length).toBe(first);
  });

  it('the other-template chips preview, and Start then starts with the where override', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Training away from your gym?');
    await press('Dumbbells only');
    await pressDay('Choose Pull A');
    await press('Start Pull A');
    await screen.findByText('Pull A (dumbbells only)');
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ where: 'dumbbells', base: 'Pull A' });
  });

  it('a second session on a dumbbells-only day adds only dumbbell versions', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Training away from your gym?');
    await press('Dumbbells only');
    await press('Start Push B');
    await screen.findByText('Push B (dumbbells only)');
    const first = stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name);
    for (const n of first) {
      await expand(n);
      const wt = screen.queryByLabelText(`${n} set 1 kg each`);
      if (wt) await fireEvent.changeText(wt, '10');
      await fireEvent.changeText(screen.getByLabelText(`${n} set 1 reps`), '10');
      await press(`Mark ${n} set 1 done`);
    }
    await press('Training again later today?');
    await press('Add Pull B');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises.length).toBeGreaterThan(first.length));
    const added = stored<Workout>(db, `workouts:${DATE}`).exercises.slice(first.length).map((e) => e.name);
    expect(added).toEqual(['One-Arm Dumbbell Row', 'Rear Delt Fly', 'Hammer Curl']); // the gym build adds Assisted Pull-up and Chest-Supported Row
  });

  it('the where override resets on a new day', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    let day = THURSDAY();
    const ui = () => withProfile(db, <WorkoutScreen db={db} now={() => day} />);
    const { rerender } = await render(ui());
    await screen.findByText('Push B day');
    await press('Training away from your gym?');
    await press('Dumbbells only');
    expect(screen.getByLabelText('Training with dumbbells only today')).toBeTruthy();
    day = new Date(2026, 9, 9, 10, 0, 0);
    await rerender(ui());
    await waitFor(() => expect(screen.getByLabelText('Training away from your gym?')).toBeTruthy());
    expect(screen.queryByLabelText('Training with dumbbells only today')).toBeNull();
  });

  it('the check-in choice is stored as ci_choice and makes the session lighter', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Sleep last night: Poor');
    expect(screen.getByText(/Lighter session suggested/)).toBeTruthy();
    expect(screen.getByLabelText('Why? Why a lighter session after poor sleep?')).toBeTruthy();
    expect(screen.queryByLabelText('Why? Is soreness a sign of a good workout?')).toBeNull();
    await press('Lighter session');
    expect(screen.getByText(/2 sets each/)).toBeTruthy();
    await press('Start Push B');
    await screen.findByText('Push B');
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ ci_choice: 'light', mods: { light: true } });
    expect(storedSets(db)).toHaveLength(10);
    expect(screen.getByText(/Today: lighter session/)).toBeTruthy();
  });

  it('very sore muscles link the soreness card instead of the sleep card', async () => {
    await setup();
    await screen.findByText('Push B day');
    await press('Soreness in today’s muscles: Very sore');
    expect(screen.getByLabelText('Why? Is soreness a sign of a good workout?')).toBeTruthy();
    expect(screen.queryByLabelText('Why? Why a lighter session after poor sleep?')).toBeNull();
  });

  it('a short check-in time keeps only the main exercises', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Time today: 30 min');
    expect(screen.getByText(/30 minutes: the main 3 exercises only/)).toBeTruthy();
    await press('Start Push B');
    await screen.findByText('Push B');
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).toEqual(PUSH_B.slice(0, 3));
  });

  it('shows a focus badge on focus-muscle exercises', async () => {
    await setup({ focus: ['chest'] });
    await screen.findByText('Push B day');
    expect(screen.getAllByText(/Focus/).length).toBeGreaterThan(0);
    expect(screen.getByText(/plus 1 on focus muscles/)).toBeTruthy();
  });
});

describe('Workout tab: logging sets', () => {
  afterEach(() => jest.restoreAllMocks());
  const lifts = { 'Barbell Bench Press': 60, 'Machine Shoulder Press': 30, 'Pec Deck Fly': 25, 'Cable Lateral Raise': 10, 'Overhead Cable Extension': 20 };

  async function started(opts: Parameters<typeof setup>[0] = {}) {
    const db = await setup({ lifts, ...opts });
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    return db;
  }

  it('Add set adds a set row; Remove last set shows only with more than one set (#147)', async () => {
    await started();
    const sets = () => screen.queryAllByLabelText(/^Barbell Bench Press set \d+ kg$/).length;
    const n = sets();
    await press('Add set to Barbell Bench Press');
    await waitFor(() => expect(sets()).toBe(n + 1));
    for (let k = n + 1; k > 1; k--) await press('Remove last set of Barbell Bench Press');
    await waitFor(() => expect(sets()).toBe(1));
    expect(screen.queryByLabelText('Remove last set of Barbell Bench Press')).toBeNull();
    expect(screen.getByText('Set removed')).toBeTruthy();
  });

  it('the set chips are named from their visible text (WCAG 2.5.3, #800)', async () => {
    await started();
    await press('Add set to Barbell Bench Press');
    expect(screen.getAllByText('Add set').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Add set to Barbell Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Remove last set of Barbell Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Remove exercise Barbell Bench Press from today')).toBeTruthy();
    await press('Remove exercise Barbell Bench Press from today');
    expect(screen.getByLabelText('Tap again to remove Barbell Bench Press from today')).toBeTruthy();
  });

  it('Add exercise lists the library without today\'s exercises and adds the pick; Remove takes a second tap (#147)', async () => {
    const db = await started();
    await press('Add exercise');
    expect(screen.queryByLabelText('Add Barbell Bench Press')).toBeNull(); // already in the session
    await press('Add Goblet Squat');
    expect(await screen.findByText('Goblet Squat added')).toBeTruthy();
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).toContain('Goblet Squat'));
    await expand('Goblet Squat');
    await press('Remove exercise Goblet Squat from today');
    expect(screen.getByLabelText('Tap again to remove Goblet Squat from today')).toBeTruthy();
    await press('Tap again to remove Goblet Squat from today');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).not.toContain('Goblet Squat'));
  });

  it('typed exercises: a library name in any case adds it; a new name asks for its muscles, then is saved and added (#312, #397)', async () => {
    const db = await started();
    const typeAndAdd = async (name: string) => {
      await press('Add exercise');
      await fireEvent.changeText(screen.getByLabelText('Your own exercise'), name);
      await press('Add the exercise you typed');
    };
    await typeAndAdd('   ');
    expect(await screen.findByText('Type an exercise name.')).toBeTruthy();
    await press('Close');
    // Zero-width only: trim() keeps it, so it must be the shared blank rule that stops it.
    await typeAndAdd(String.fromCharCode(0x200b, 0x2060, 0xfeff));
    expect(await screen.findByText('Type an exercise name.')).toBeTruthy();
    expect(screen.queryByLabelText(/with these muscles/)).toBeNull();
    await press('Close');
    await typeAndAdd('goblet squat');
    expect(await screen.findByText('Goblet Squat added')).toBeTruthy();
    await typeAndAdd('x'.repeat(201));
    expect(await screen.findByText('That exercise name is too long. Shorten it.')).toBeTruthy();
    await press('Close');
    await typeAndAdd('Cossack Squat');
    await press('Add Cossack Squat with these muscles');
    expect(await screen.findByText('Pick at least one main muscle.')).toBeTruthy();
    await press('Main muscle: quads');
    await press('Also working: glutes');
    await press('Add Cossack Squat with these muscles');
    expect(await screen.findByText('Cossack Squat added')).toBeTruthy();
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).toContain('Cossack Squat'));
    await waitFor(() => expect(JSON.parse(db.rows.get('user_settings:me')!).custom_tags['Cossack Squat']).toEqual({ pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: ['quads'], secondary: ['glutes'], joints: [] }));
    expect(screen.getByText('Cossack Squat')).toBeTruthy();
  });

  it('a typed name the save refuses (a near-duplicate a pull stored meanwhile) is not added to the workout (#664)', async () => {
    const db = await started();
    // Another device's 'Cossack Squat' is stored, but this screen has not reloaded it yet, so it asks for the muscles.
    const tag = { pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: ['quads'], secondary: [], joints: [] } as const;
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), custom_tags: { 'Cossack Squat': tag } });
    await press('Add exercise');
    await fireEvent.changeText(screen.getByLabelText('Your own exercise'), 'COSSACK SQUAT');
    await press('Add the exercise you typed');
    await press('Main muscle: quads');
    await press('Add COSSACK SQUAT with these muscles');
    expect(await screen.findByText('That name matches Cossack Squat. Use that name instead.')).toBeTruthy();
    const names = stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name);
    expect(names).not.toContain('COSSACK SQUAT');
    expect(Object.keys(JSON.parse(db.rows.get('user_settings:me')!).custom_tags)).toEqual(['Cossack Squat']);
  });

  it('shows core’s suggestion, target and warm-up line', async () => {
    await started();
    // 3 sets of 10 at 60 kg on a 6–10 barbell lift: add one 2.5 kg step and aim for the bottom of the range.
    expect(screen.getByText('Suggested: 62.5 kg × 6–10 reps')).toBeTruthy();
    // Suggestion, reason and warm-up are inline: the guide stays closed here.
    expect(screen.getAllByLabelText('Why? How the suggested weight is chosen').length).toBeGreaterThan(0);
    expect(placeholder('Barbell Bench Press set 1 kg')).toBe('62.5');
    expect(placeholder('Barbell Bench Press set 1 reps')).toBe('6');
    expect(screen.getByText(/8 reps at 32.5 kg, then 4 at 47.5 kg/)).toBeTruthy();
    expect(screen.getByLabelText('Why? Why warm up before the first big lift?, Barbell Bench Press')).toBeTruthy();
    await openGuide('Barbell Bench Press'); // the rest line is reference material
    expect(screen.getByLabelText('Why? Why rest 2–3 minutes on big lifts?, Barbell Bench Press')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Why these exercises? How your sessions are built'));
    expect(await screen.findByText(/You train 6 days a week, so your plan uses push\/pull\/legs twice, which trains .* Sessions are trimmed to fit about 60 minutes, keeping/)).toBeTruthy();
    expect(screen.queryByText(/starting with 2 sets per exercise/)).toBeNull();
  });

  it('ticking an empty set takes the target, writes the set and the lift stat, and starts the rest timer', async () => {
    const db = await started();
    frozenClock(); // restored after each test below
    await press('Mark Barbell Bench Press set 1 done');
    await waitFor(() => expect(storedSets(db).find((s) => s.done)).toBeTruthy());
    const s = storedSets(db).find((x) => x.done) as WorkoutSet;
    expect(s).toMatchObject({ exercise: 'Barbell Bench Press', kind: 'work', set_index: 0, weight_kg: 62.5, reps: 6, done: true, rate: null });
    expect(s.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // lift_stats keeps core's own record shape, as updateLift returns it.
    await waitFor(() => expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').date).toBe(DATE));
    const l = stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press');
    expect(l).toMatchObject({ n: 3, first: '2026-09-20', form: null, sets: [{ w: 62.5, r: 6, rate: null }] });
    expect(l.pbToast).toBeUndefined();
    expect(l.prev).toMatchObject({ date: '2026-10-05', form: 'yes' });
    expect(l.hist?.at(-1)).toEqual({ date: DATE, e: 75 });

    expect(screen.getByLabelText('Rest 2:30')).toBeTruthy();
    // The panel sits in an opaque dock, so the "How to do" link under it cannot show through the gap.
    const dock = screen.getByLabelText('Rest timer').parent;
    expect(StyleSheet.flatten(dock?.props.style)).toMatchObject({ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: expect.any(String) });
    expect(screen.getByText('Next: set 2 of Barbell Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Mark Barbell Bench Press set 1 done').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('1 of 15 sets done, 375 kg lifted')).toBeTruthy();
  });

  async function removeExercise(name: string) {
    await expand(name);
    await press(`Remove exercise ${name} from today`);
    await press(`Tap again to remove ${name} from today`);
    await waitFor(() => expect(screen.queryByLabelText(`Mark ${name} set 1 done`)).toBeNull());
  }
  async function cutToOneSet(name: string) {
    await expand(name);
    while (screen.queryByLabelText(`Remove last set of ${name}`)) await press(`Remove last set of ${name}`);
  }

  it('the rest dock never names an exercise that was removed: it moves on to the next one (#1141)', async () => {
    await started();
    await cutToOneSet('Barbell Bench Press');
    await press('Mark Barbell Bench Press set 1 done');
    expect(screen.getByText('Next: Machine Shoulder Press')).toBeTruthy();
    await removeExercise('Machine Shoulder Press');
    expect(screen.queryByText('Next: Machine Shoulder Press')).toBeNull();
    expect(screen.getByText('Next: Pec Deck Fly')).toBeTruthy();
    for (const n of ['Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension']) await removeExercise(n);
    expect(screen.queryByTestId('rest-title')).toBeNull(); // nothing left to do: the dock closes
  });

  it('after a removal the dock names only exercises after the ticked one, never an earlier skipped one (#1141)', async () => {
    await started();
    await cutToOneSet('Machine Shoulder Press');
    await press('Mark Machine Shoulder Press set 1 done'); // Bench is skipped
    expect(screen.getByText('Next: Pec Deck Fly')).toBeTruthy();
    await removeExercise('Pec Deck Fly');
    expect(screen.getByText('Next: Cable Lateral Raise')).toBeTruthy();
    expect(screen.queryByText('Next: Barbell Bench Press')).toBeNull();
  });

  it('ticking the final set closes the rest dock, so it does not cover the Session done panel (#1141)', async () => {
    await started();
    for (const n of PUSH_B.slice(1)) await removeExercise(n);
    await expand('Barbell Bench Press');
    await press('Mark Barbell Bench Press set 1 done');
    expect(screen.getByText('Next: set 2 of Barbell Bench Press')).toBeTruthy();
    for (let k = 2; screen.queryByLabelText(`Mark Barbell Bench Press set ${k} done`); k++) await press(`Mark Barbell Bench Press set ${k} done`);
    expect(screen.queryByTestId('rest-title')).toBeNull();
    expect(screen.queryByText(/^Next:/)).toBeNull();
  });

  it('the rest timer’s +30 s button adds core’s REST_EXTEND_SEC', async () => {
    await started();
    // A frozen clock, so the countdown reads exactly 2:30, then 3:00.
    const clock = frozenClock();
    try {
      await press('Mark Barbell Bench Press set 1 done');
      expect(await screen.findByLabelText('Rest 2:30')).toBeTruthy();
      await press('+30 s');
      expect(await screen.findByLabelText('Rest 3:00')).toBeTruthy();
    } finally {
      clock.mockRestore();
    }
  });

  it('with the rest timer turned off in settings, ticking a set shows no rest timer but still saves', async () => {
    const db = await started({ restOff: true });
    await press('Mark Barbell Bench Press set 1 done');
    await waitFor(() => expect(storedSets(db).find((s) => s.done)).toBeTruthy());
    expect(screen.queryByLabelText('Rest timer')).toBeNull();
    expect(screen.getByText('1 of 15 sets done, 375 kg lifted')).toBeTruthy();
  });

  it('shows the rough calories burned once a set is ticked, and cardio minutes are saved and counted', async () => {
    const db = await started();
    expect(screen.queryByText(/kcal burned/)).toBeNull();
    await press('Mark Barbell Bench Press set 1 done');
    // One set, about 3 minutes, at the 82 kg profile weight: core's workoutBurn.
    expect(await screen.findByText('About 20 kcal burned')).toBeTruthy();
    expect(screen.getByText(/Rough estimate from 1 set \(about 3 minutes\) at your bodyweight; about 15 kcal of it is above what you’d burn resting/)).toBeTruthy();

    expect(screen.getByLabelText('Cardio minutes').props.value).toBe('');
    fireEvent.changeText(screen.getByLabelText('Cardio minutes'), '30');
    expect(await screen.findByText('About 225 kcal burned')).toBeTruthy();
    expect(screen.getByText(/plus 30 min cardio/)).toBeTruthy();
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).cardio_min).toBe(30));

    fireEvent.changeText(screen.getByLabelText('Cardio minutes'), '');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).cardio_min).toBeNull());
  });

  it('uses the latest weigh-in on or before the day, not the profile weight, for the burn', async () => {
    // One set (about 3 minutes) burns 20 kcal at the 82 kg profile weight, 15 at 60 kg, 25 at 100 kg and 35 at 140 kg.
    await started({ weighIns: [{ date: '2026-10-01', weight_kg: 60 }, { date: '2026-10-07', weight_kg: 100 }, { date: '2026-10-09', weight_kg: 140 }] });
    await press('Mark Barbell Bench Press set 1 done');
    expect(await screen.findByText('About 25 kcal burned')).toBeTruthy();
  });

  it('asks for a weight when there is neither a weigh-in nor a profile weight, and not before a set is ticked', async () => {
    await started({ weightKg: 0 });
    expect(screen.queryByText(/Add your weight/)).toBeNull();
    await press('Mark Barbell Bench Press set 1 done');
    expect(await screen.findByText('Add your weight (setup or Progress tab) to see calories burned.')).toBeTruthy();
    expect(screen.queryByText(/kcal burned/)).toBeNull();
  });

  it('does not flash the add-your-weight hint while the weigh-ins load, when the profile has a weight', async () => {
    fakeClock();
    const db = await setup({ lifts });
    const real = db.getAllAsync.bind(db);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    db.getAllAsync = (async (sql: string, ...args: (string | number)[]) => {
      if (/FROM weights/.test(sql)) await gate;
      return real(sql, ...args);
    }) as typeof db.getAllAsync;
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    await press('Mark Barbell Bench Press set 1 done');
    await flush();
    expect(screen.queryByText(/Add your weight/)).toBeNull();
    release();
    expect(await screen.findByText('About 20 kcal burned')).toBeTruthy();
  });

  it('saves cardio minutes as a whole number: 1.5 and 1,5 round to 2, blank or NBSP-only clears, junk is capped', async () => {
    const db = await started();
    const saved = () => stored<Workout>(db, `workouts:${DATE}`).cardio_min;
    const type = async (text: string, want: number | null) => {
      fireEvent.changeText(screen.getByLabelText('Cardio minutes'), text);
      await waitFor(() => expect(saved()).toBe(want));
    };
    await type('1.5', 2);
    await type('1,5', 2);
    await type('20', 20);
    await type('\u00A0', null);
    await type('20', 20);
    await type('', null);
    await type('45 ', 45);
    await type('-5', 0);
    await type('99999', 9999);
  });

  it('cardio minutes typed one key at a time: 1.5 and 1,5 save 2, -5 saves 0, and the field shows what was typed', async () => {
    const db = await started();
    const saved = () => stored<Workout>(db, `workouts:${DATE}`).cardio_min;
    const keys = async (text: string, want: number | null) => {
      await fireEvent.changeText(screen.getByLabelText('Cardio minutes'), '');
      for (const k of text) await fireEvent.changeText(screen.getByLabelText('Cardio minutes'), `${screen.getByLabelText('Cardio minutes').props.value}${k}`);
      expect(screen.getByLabelText('Cardio minutes').props.value).toBe(text);
      await waitFor(() => expect(saved()).toBe(want));
    };
    await keys('1.5', 2);
    await keys('1,5', 2);
    await keys('-5', 0);
    await keys('45', 45);
  });

  it('refuses to tick a first-time set with nothing to fill from', async () => {
    const db = await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
    await press('Mark Barbell Bench Press set 1 done');
    expect(await screen.findByText('Enter the weight and reps first.')).toBeTruthy();
    expect(storedSets(db).some((s) => s.done)).toBe(false);
  });

  it('announces the empty-tick message to screen readers (iOS has no live regions)', async () => {
    const os = Platform.OS;
    const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    Platform.OS = 'ios';
    try {
      await setup();
      await press('Start Push B');
      await screen.findByText('Push B');
      await press('Mark Barbell Bench Press set 1 done');
      await screen.findByText('Enter the weight and reps first.');
      expect(say).toHaveBeenCalledWith('Enter the weight and reps first.');
      expect(screen.getByText('Enter the weight and reps first.').props.accessibilityLiveRegion).toBe('polite');
    } finally {
      Platform.OS = os;
      say.mockRestore();
    }
  });

  it('rating a set stores it and adjusts the next target (Easy adds a step)', async () => {
    const db = await started();
    await press('Mark Barbell Bench Press set 1 done');
    expect(screen.getAllByLabelText('Why? Why rate how each set felt?').length).toBeGreaterThan(0);
    await press('Barbell Bench Press set 1: Easy');
    await waitFor(() => expect(storedSets(db).find((s) => s.rate)?.rate).toBe('easy'));
    expect(placeholder('Barbell Bench Press set 2 kg')).toBe('65');
    await press('Barbell Bench Press set 1 rated Easy. Change rating');
    await waitFor(() => expect(storedSets(db).every((s) => s.rate === null)).toBe(true));
  });

  it('asks about form after the last set and stores the answer on the exercise', async () => {
    const db = await started();
    await expand('Overhead Cable Extension');
    for (const j of [1, 2, 3]) await press(`Mark Overhead Cable Extension set ${j} done`);
    await press('Overhead Cable Extension form: Not really');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.form).toBe('no'));
    expect(stored<LiftRecord>(db, 'lift_stats:Overhead Cable Extension').form).toBe('no');
  });

  describe('first-time rough guess (#621)', () => {
    it('shows from a real lift of the paired exercise, with each-hand weights on the paired one', async () => {
      await setup({ lifts: { 'Dumbbell Bench Press': 20 } });
      await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
      await screen.findByText('Push B');
      expect(screen.getByText('Rough guess from your Dumbbell Bench Press (20 kg each): about 45 kg. Use the ramp to confirm.')).toBeTruthy();
    });

    it('labels the paired lift with the type the user set for it', async () => {
      await setup({ lifts: { 'Dumbbell Bench Press': 20 }, overrides: { 'Dumbbell Bench Press': { type: 'barbell', step_kg: 2.5, rep_low: 6, rep_high: 10 } } });
      await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
      await screen.findByText('Push B');
      expect(screen.getByText('Rough guess from your Dumbbell Bench Press (20 kg): about 45 kg. Use the ramp to confirm.')).toBeTruthy();
    });

    it('shows nothing without a lift of a paired exercise', async () => {
      await setup({ lifts: { 'Lat Pulldown': 40 } });
      await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
      await screen.findByText('Push B');
      expect(screen.queryByText(/Rough guess/)).toBeNull();
    });
  });

  describe('Learn mode block (#623)', () => {
    it('opens Setup on the very first session of an exercise', async () => {
      await setup();
      await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
      await screen.findByText('Push B');
      // Inline for every exercise: the row is collapsed and Guide and tools is closed.
      expect(screen.getByLabelText('Setup steps for Overhead Cable Extension').props.accessibilityState).toMatchObject({ expanded: true });
      expect(screen.getByText(`1. ${getCatalog().cards['Overhead Cable Extension']!.setup[0]}`)).toBeTruthy();
      await expand('Overhead Cable Extension');
      await fireEvent.changeText(screen.getByLabelText('Overhead Cable Extension set 1 kg'), '20');
      await fireEvent.changeText(screen.getByLabelText('Overhead Cable Extension set 1 reps'), '10');
      await press('Mark Overhead Cable Extension set 1 done');
      await waitFor(() => expect(screen.getByLabelText('Setup steps for Overhead Cable Extension').props.accessibilityState).toMatchObject({ expanded: false }));
    });

    it('shows on a card in learn mode with Setup closed after earlier sessions, and goes once the sets are done', async () => {
      await setup({ lifts: { 'Overhead Cable Extension': 20 } });
      await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
      await screen.findByText('Push B');
      expect(screen.getAllByText('Learn mode').length).toBeGreaterThan(0);
      expect(screen.getByLabelText('Setup steps for Overhead Cable Extension').props.accessibilityState).toMatchObject({ expanded: false });
      await expand('Overhead Cable Extension');
      for (const j of [1, 2, 3]) await press(`Mark Overhead Cable Extension set ${j} done`);
      expect(screen.queryByLabelText('Setup steps for Overhead Cable Extension')).toBeNull();
    });
  });

  describe('feel check after a set (#485)', () => {
    const NAME = 'Overhead Cable Extension';
    const startedOnName = async () => {
      const db = await started();
      await expand(NAME);
      return db;
    };
    it('shows only once a set is done, then stores the answer and its tip', async () => {
      const db = await startedOnName();
      expect(screen.queryByText('Where did you feel that set most?')).toBeNull();
      await press(`Mark ${NAME} set 1 done`);
      expect(await screen.findByText('Where did you feel that set most?')).toBeTruthy();
      await press(`${NAME} felt: Shoulders`);
      expect(await screen.findByText('Use a lighter weight and keep your elbows closer together.', { exact: false })).toBeTruthy();
      await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.feel).toBe('0'));
    });

    it('the right place is stored as target', async () => {
      const db = await startedOnName();
      await press(`Mark ${NAME} set 1 done`);
      await press(`${NAME} felt: Back of the upper arms (triceps)`);
      expect(await screen.findByText('Felt it in the right place. Good.')).toBeTruthy();
      await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.feel).toBe('target'));
    });

    it('is not asked once the exercise is out of learn mode', async () => {
      const db = await setup({ lifts });
      db.rows.set(`lift_stats:${NAME}`, JSON.stringify({ ...stored<LiftRecord>(db, `lift_stats:${NAME}`), n: 3 }));
      await screen.unmount();
      await mount(db);
      await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
      await screen.findByText('Push B');
      await expand(NAME);
      await press(`Mark ${NAME} set 1 done`);
      await waitFor(() => expect(storedSets(db).some((x) => x.done)).toBe(true));
      expect(screen.queryByText('Where did you feel that set most?')).toBeNull();
    });

    it('It hurt shows the safety note; Skip remaining sets keeps only the done sets', async () => {
    fakeClock();
      const db = await startedOnName();
      await press(`Mark ${NAME} set 1 done`);
      await press(`${NAME}: It hurt`);
      expect(await screen.findByText('Stop this exercise for today.')).toBeTruthy();
      expect(screen.getByText(/Pain is different from muscle effort or burning\. If it happens again next session, pick a different exercise, and see a physio if it keeps happening\./)).toBeTruthy();
      await press(`Skip remaining sets of ${NAME}`);
      expect(await screen.findByText('Skipped the remaining sets')).toBeTruthy();
      expect(screen.queryByLabelText(`${NAME} set 2 kg`)).toBeNull();
      expect(screen.queryByLabelText(`Skip remaining sets of ${NAME}`)).toBeNull();
      await waitFor(() => expect(storedSets(db).filter((x) => x.exercise === NAME && x.kind === 'work' && !x.deleted_at)).toHaveLength(1));
      expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.feel).toBe('pain');
    });

    it('the answer is still there after the app is reopened', async () => {
      const db = await startedOnName();
      await press(`Mark ${NAME} set 1 done`);
      await press(`${NAME} felt: Back of the upper arms (triceps)`);
      await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.feel).toBe('target'));
      await screen.unmount();
      await mount(db);
      await screen.findByText('Push B');
      await expand(NAME); // a reopened session expands the first exercise with sets left
      expect(await screen.findByText('Felt it in the right place. Good.')).toBeTruthy();
      expect(screen.queryByText('Where did you feel that set most?')).toBeNull();
    });

    it('Skip remaining sets renumbers the sets left, so a set added next gets a free position', async () => {
      const db = await startedOnName();
      await press(`Mark ${NAME} set 1 done`);
      await press(`Mark ${NAME} set 3 done`); // done, not done, done
      await press(`${NAME}: It hurt`);
      await press(`Skip remaining sets of ${NAME}`);
      await waitFor(() => expect(screen.queryByLabelText(`${NAME} set 3 kg`)).toBeNull());
      await press(`Add set to ${NAME}`);
      await waitFor(() => expect(screen.getByLabelText(`${NAME} set 3 kg`)).toBeTruthy());
      await waitFor(() => {
        const live = storedSets(db).filter((x) => x.exercise === NAME && x.kind === 'work' && !x.deleted_at);
        expect(live.map((x) => x.set_index).sort()).toEqual([0, 1, 2]);
      });
    });

    it('It hurt then Find an alternative opens the can\'t-do sheet at "for how long" with pain', async () => {
      await startedOnName();
      await press(`Mark ${NAME} set 1 done`);
      await press(`${NAME}: It hurt`);
      await press(`Find an alternative to ${NAME}`);
      expect(await screen.findByText(`Can’t do ${NAME}?`)).toBeTruthy();
      expect(screen.queryByText('Why not? This decides what the app suggests instead.')).toBeNull();
      expect(screen.getByText('Pain is a signal to stop, not push through. If it keeps happening or came from an injury, see a physio.')).toBeTruthy();
      // Pain's default scope is the joint, as in the prototype's defaultScope (the exercise's first joint, the elbow).
      await press('Permanently');
      const joint = await screen.findByLabelText(/^Anything that loads the .*elbow/i);
      expect(joint.props.accessibilityState.checked).toBe(true);
    });
  });

  it('keeps what was ticked after the app is reopened', async () => {
    const db = await started();
    await expand('Pec Deck Fly');
    await fireEvent.changeText(screen.getByLabelText('Pec Deck Fly set 1 kg'), '27.5');
    await fireEvent.changeText(screen.getByLabelText('Pec Deck Fly set 1 reps'), '11');
    await press('Mark Pec Deck Fly set 1 done');
    await waitFor(() => expect(storedSets(db).find((s) => s.done)).toBeTruthy());
    await screen.unmount();
    await mount(db);
    await screen.findByText('Push B');
    await expand('Pec Deck Fly');
    expect(screen.getByLabelText('Mark Pec Deck Fly set 1 done').props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText('Pec Deck Fly set 1 kg').props.value).toBe('27.5');
    expect(screen.getByLabelText('Pec Deck Fly set 1 reps').props.value).toBe('11');
    expect(screen.queryByLabelText('Start Push B')).toBeNull();
  });

  it('opens the how-to card from content (long keys)', async () => {
    await started();
    await openGuide('Barbell Bench Press');
    await press('How to do Barbell Bench Press');
    const card = getCatalog().cards['Barbell Bench Press']!;
    expect(await screen.findByText(`• ${card.key_cues[0]}`)).toBeTruthy();
    expect(screen.getByText(`1. ${card.setup[0]}`)).toBeTruthy();
    expect(screen.getByText(`• ${card.common_mistakes[0]}`)).toBeTruthy();
    expect(screen.getByText(card.where_to_feel, { exact: false })).toBeTruthy();
  });

  it('offers a second session once every exercise has a done set, and adds it as part 2', async () => {
    const db = await started();
    for (const n of PUSH_B) {
      await expand(n);
      await press(`Mark ${n} set 1 done`);
    }
    await press('Training again later today?');
    await press('Add Pull B');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).template).toBe('Push B + Pull B'));
    const w = stored<Workout>(db, `workouts:${DATE}`);
    expect(w.base).toBe('Push B');
    expect(w.exercises.slice(0, 5).every((e) => e.part === 1)).toBe(true);
    expect(w.exercises.slice(5).length).toBeGreaterThan(0);
    expect(w.exercises.slice(5).every((e) => e.part === 2)).toBe(true);
    expect(screen.getByText('Second session')).toBeTruthy();
    expect(screen.queryByLabelText('Training again later today?')).toBeNull();
  });
});

describe('Workout tab: first-time ramp', () => {
  it('shows short visible text on the ramp buttons and keeps the exercise in the spoken name, so they fit 360 px (#900)', async () => {
    await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
    // The exercise name in the visible text made the buttons wider than a 360 px screen (prototype: "Start the ramp", "I know my weight").
    expect(screen.getAllByText('Start the ramp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('I know my weight').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Start the ramp for /)).toBeNull();
    expect(screen.queryByText(/^I know my weight for /)).toBeNull();
    await expand('Machine Shoulder Press');
    expect(screen.getByLabelText('Start the ramp for Machine Shoulder Press')).toBeTruthy();
    expect(screen.getByLabelText('I know my weight for Machine Shoulder Press')).toBeTruthy();
  });

  it('starts a ramp, stores its sets as kind ramp, and the rated weight becomes the working target', async () => {
    const db = await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
    await expand('Machine Shoulder Press');
    await press('Start the ramp for Machine Shoulder Press');
    await fireEvent.changeText(screen.getByLabelText('Machine Shoulder Press ramp set 1 weight'), '20');
    await press('Mark Machine Shoulder Press ramp set 1 done');
    await press('Machine Shoulder Press ramp set 1: Just right');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[1]?.found_kg).toBe(20));
    const ramp = storedSets(db).filter((s) => s.kind === 'ramp');
    expect(ramp).toHaveLength(1);
    expect(ramp[0]).toMatchObject({ exercise: 'Machine Shoulder Press', set_index: 0, weight_kg: 20, reps: 10, done: true, rate: 'right' });
    expect(placeholder('Machine Shoulder Press set 1 kg')).toBe('20');
    expect(screen.getByText(/Working weight found/)).toBeTruthy();
  });

  it('shows the Easy note after an Easy ramp set, with the next step, and drops it for a later rating (#823)', async () => {
    await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
    await expand('Machine Shoulder Press');
    await press('Start the ramp for Machine Shoulder Press');
    expect(screen.queryByText(/^Easy, so add a step/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Machine Shoulder Press ramp set 1 weight'), '20');
    await press('Mark Machine Shoulder Press ramp set 1 done');
    expect(screen.queryByText(/^Easy, so add a step/)).toBeNull(); // done but not rated yet
    await press('Machine Shoulder Press ramp set 1: Easy');
    // A machine's step is 5 kg and its range starts at 8 reps.
    expect(await screen.findByText('Easy, so add a step (about 25 kg) and do another ramp set of 8 reps.')).toBeTruthy();
    await press('Mark Machine Shoulder Press ramp set 2 done'); // takes the +1 step weight
    await press('Machine Shoulder Press ramp set 2: Just right');
    await waitFor(() => expect(screen.getByText(/Working weight found/)).toBeTruthy());
    expect(screen.queryByText(/^Easy, so add a step/)).toBeNull();
  });

  it('keeps the find-your-weight guide hidden after "I know my weight", also after a reload (#139)', async () => {
    const db = await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
    // One exercise is expanded at a time, so count the guides by expanding each exercise in turn.
    const countGuides = async () => {
      let n = 0;
      for (const name of PUSH_B) {
        await expand(name);
        n += screen.queryAllByText('First time: find your weight').length;
      }
      return n;
    };
    const guides = await countGuides();
    expect(guides).toBeGreaterThan(1);
    await expand('Machine Shoulder Press');
    expect(screen.getByLabelText('Start the ramp for Machine Shoulder Press')).toBeTruthy();
    await press('I know my weight for Machine Shoulder Press');
    // Only that exercise's guide goes; the other new exercises keep theirs.
    expect(screen.queryByLabelText('Start the ramp for Machine Shoulder Press')).toBeNull();
    expect(screen.queryByLabelText('I know my weight for Machine Shoulder Press')).toBeNull();
    expect(await countGuides()).toBe(guides - 1);
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[1]).toMatchObject({ name: 'Machine Shoulder Press', skip_ramp: true, found_kg: null }));
    expect(storedSets(db).filter((s) => s.kind === 'ramp')).toHaveLength(0);
    // The working sets are still there to log.
    await expand('Machine Shoulder Press');
    expect(screen.getByLabelText('Machine Shoulder Press set 1 kg')).toBeTruthy();
    await expand('Pec Deck Fly');
    expect(screen.getByLabelText('Start the ramp for Pec Deck Fly')).toBeTruthy();

    await screen.unmount();
    await mount(db);
    await screen.findByText('Push B');
    expect(await countGuides()).toBe(guides - 1);
    await expand('Machine Shoulder Press');
    expect(screen.queryByLabelText('Start the ramp for Machine Shoulder Press')).toBeNull();
    expect(screen.queryByLabelText('I know my weight for Machine Shoulder Press')).toBeNull();
    await expand('Pec Deck Fly');
    expect(screen.getByLabelText('Start the ramp for Pec Deck Fly')).toBeTruthy();
  });
});

describe('Workout tab: personal best', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('an armed Remove exercise disarms after 4 seconds (#443)', async () => {
    await setup({ lifts: { 'Barbell Bench Press': 60 } });
    await press('Start Push B');
    await screen.findByText('Push B');
    await press('Remove exercise Barbell Bench Press from today');
    expect(screen.getByLabelText('Tap again to remove Barbell Bench Press from today')).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(4100));
    expect(screen.getByLabelText('Remove exercise Barbell Bench Press from today')).toBeTruthy();
  });

  it('toasts a personal best once a day and records pb_toast_date', async () => {
    const lifts = { 'Barbell Bench Press': 60 };
    const db = await setup({ lifts, hist: { 'Barbell Bench Press': [80, 90] } });
    await press('Start Push B');
    await screen.findByText('Push B');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '70');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '10');
    await press('Mark Barbell Bench Press set 1 done');
    // 70 kg x 10 scores 93.3 against a best of 90: more than 0.5% better.
    expect(await screen.findByText('New personal best on Barbell Bench Press')).toBeTruthy();
    expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').pbToast).toBe(DATE);

    await act(async () => void jest.advanceTimersByTime(3000));
    expect(screen.queryByText(/New personal best/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 2 kg'), '72.5');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 2 reps'), '10');
    await press('Mark Barbell Bench Press set 2 done');
    await waitFor(() => expect(storedSets(db).filter((s) => s.done)).toHaveLength(2));
    expect(screen.queryByText(/New personal best/)).toBeNull();
    expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').pbToast).toBe(DATE);
  });

  it('vibrates once for a personal best, and not for the same day\'s next set (#823)', async () => {
    const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    const lifts = { 'Barbell Bench Press': 60 };
    const db = await setup({ lifts, hist: { 'Barbell Bench Press': [80, 90] } });
    await press('Start Push B');
    await screen.findByText('Push B');
    vibrate.mockClear(); // starting the session or ticking a set may start a rest; only the PB buzz is counted here
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '70');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '10');
    await press('Mark Barbell Bench Press set 1 done');
    expect(await screen.findByText('New personal best on Barbell Bench Press')).toBeTruthy();
    expect(vibrate.mock.calls.filter(([p]) => p === 60)).toHaveLength(1);
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 2 kg'), '72.5');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 2 reps'), '10');
    await press('Mark Barbell Bench Press set 2 done');
    await waitFor(() => expect(storedSets(db).filter((s) => s.done)).toHaveLength(2));
    expect(vibrate.mock.calls.filter(([p]) => p === 60)).toHaveLength(1);
    vibrate.mockRestore();
  });

  it('does not vibrate when the session is not a new best (#823)', async () => {
    const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    await setup({ lifts: { 'Barbell Bench Press': 60 }, hist: { 'Barbell Bench Press': [80, 90] } });
    await press('Start Push B');
    await screen.findByText('Push B');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '60');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '10');
    await press('Mark Barbell Bench Press set 1 done');
    await waitFor(() => expect(screen.getByLabelText('Mark Barbell Bench Press set 1 done').props.accessibilityState.checked).toBe(true));
    expect(vibrate.mock.calls.filter(([p]) => p === 60)).toHaveLength(0);
    vibrate.mockRestore();
  });

  it('does not toast when the session is not a new best', async () => {
    await setup({ lifts: { 'Barbell Bench Press': 60 }, hist: { 'Barbell Bench Press': [80, 90] } });
    await press('Start Push B');
    await screen.findByText('Push B');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '60');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '10');
    await press('Mark Barbell Bench Press set 1 done');
    await waitFor(() => expect(screen.getByLabelText('Mark Barbell Bench Press set 1 done').props.accessibilityState.checked).toBe(true));
    expect(screen.queryByText(/New personal best/)).toBeNull();
  });
});

describe('Workout tab: write ordering and guards', () => {
  const lifts = { 'Barbell Bench Press': 60, 'Machine Shoulder Press': 30, 'Pec Deck Fly': 25, 'Cable Lateral Raise': 10, 'Overhead Cable Extension': 20 };

  it('two quick presses of Start make one session with unique set indexes', async () => {
    const db = await setup();
    const start = await screen.findByLabelText('Start Push B');
    let logReads = 0;
    const orig = db.getAllAsync;
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('GROUP BY')) logReads++;
      return orig(sql, ...p);
    }) as typeof orig;
    await act(async () => {
      start.props.onClick({});
      start.props.onClick({});
    });
    await screen.findByText('Push B');
    expect(logReads).toBe(1);
    await waitFor(() => expect(storedSets(db)).toHaveLength(15));
    const keys = storedSets(db).map((s) => `${s.exercise}/${s.kind}/${s.set_index}`);
    expect(new Set(keys).size).toBe(15);
  });

  it('two quick presses of a second-session chip add the session once', async () => {
    const db = await setup({ lifts });
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    for (const n of PUSH_B) {
      await expand(n);
      await press(`Mark ${n} set 1 done`);
    }
    await press('Training again later today?');
    const add = screen.getByLabelText('Add Pull B');
    await act(async () => {
      add.props.onClick({});
      add.props.onClick({});
    });
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).template).toBe('Push B + Pull B'));
    await waitFor(() => expect(storedSets(db).length).toBeGreaterThan(15));
    const keys = storedSets(db).map((s) => `${s.exercise}/${s.kind}/${s.set_index}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a rating given straight after a tick is kept in lift_stats even when the tick saves slowly', async () => {
    fakeClock();
    const db = await setup({ lifts });
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    // The tick's save stays queued until the test opens the gate, so the rating is given while it is still slow.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    db.hold = (sql) => (sql.includes('workout_sets') ? gate : undefined);
    await press('Mark Barbell Bench Press set 1 done');
    await press('Barbell Bench Press set 1: Easy');
    await flush();
    // The gate really held the tick's save: nothing is stored yet.
    expect(storedSets(db).find((s) => s.done && s.exercise === 'Barbell Bench Press')).toBeUndefined();
    await act(async () => release());
    await waitFor(() => expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').sets[0]?.rate).toBe('easy'));
    await waitFor(() => expect(storedSets(db).find((s) => s.done)?.rate).toBe('easy'));
  });

  it('a form answer on one exercise is kept when a tick on another saves slowly', async () => {
    fakeClock();
    const db = await setup({ lifts });
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await expand('Overhead Cable Extension');
    for (const j of [1, 2, 3]) await press(`Mark Overhead Cable Extension set ${j} done`);
    await waitFor(() => expect(storedSets(db).filter((s) => s.done)).toHaveLength(3));
    // The tick's save stays queued until the test opens the gate, so the answer is given while it is still slow.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await expand('Barbell Bench Press');
    db.hold = (sql) => (sql.includes('INTO workouts') || sql.includes('workout_sets') ? gate : undefined);
    await press('Mark Barbell Bench Press set 1 done');
    await expand('Overhead Cable Extension');
    await press('Overhead Cable Extension form: Not really');
    await flush();
    // The gate really held the tick's save: the Bench tick is not stored yet.
    expect(storedSets(db).find((s) => s.done && s.exercise === 'Barbell Bench Press')).toBeUndefined();
    await act(async () => release());
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.form).toBe('no'));
    await waitFor(() => expect(stored<LiftRecord>(db, 'lift_stats:Overhead Cable Extension').form).toBe('no'));
    expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').date).toBe(DATE);
  });

  it('keeps the check-in choice when another template is started', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Sleep last night: Poor');
    await press('Lighter session');
    await pressDay('Choose Pull B');
    await press('Start Pull B');
    await waitFor(() => expect(db.rows.get(`workouts:${DATE}`)).toBeDefined());
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ base: 'Pull B', ci_choice: 'light', mods: { light: true } });
  });

  it('names the template with the away-from-gym suffix', async () => {
    const db = await setup({ where: 'dumbbells' });
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await waitFor(() => expect(db.rows.get(`workouts:${DATE}`)).toBeDefined());
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ template: 'Push B (dumbbells only)', base: 'Push B' });
  });
});

describe('stored set records', () => {
  const ex = (): ExState => ({ name: 'Pec Deck Fly', part: 1, bridge: false, form: null, found: null, skipRamp: false, feel: null, ramp: [], sets: [{ ...blankRow(), w: '-5', r: '-3', done: true }] });

  it('never stores a negative weight or reps (contract minimum 0)', () => {
    const r = setRecord(ex(), 'work', 0, new Date(2026, 9, 8));
    expect(r.weight_kg).toBe(0);
    expect(r.reps).toBe(0);
  });

  it('counts only sets that are not deleted in the session log', async () => {
    const db = memoryDb();
    const e = ex();
    e.sets[0] = { ...blankRow(), w: '20', r: '10', done: true };
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ date: DATE, base: 'Push B', template: 'Push B', deleted_at: null }));
    await saveSet(db, DATE, setRecord(e, 'work', 0, new Date(2026, 9, 8)));
    expect(await loadSessionLog(db)).toEqual({ [DATE]: { t: 'Push B', n: 1 } });
    await saveSet(db, DATE, { ...setRecord(e, 'work', 0, new Date(2026, 9, 8)), deleted_at: '2026-10-08T10:00:00Z' });
    expect(await loadSessionLog(db)).toEqual({});
  });

  it("labels a session with no base or template with core's HAND_PICKED", async () => {
    const db = memoryDb();
    const e = ex();
    e.sets[0] = { ...blankRow(), w: '20', r: '10', done: true };
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ date: DATE, base: null, template: null, deleted_at: null }));
    await saveSet(db, DATE, setRecord(e, 'work', 0, new Date(2026, 9, 8)));
    expect((await loadSessionLog(db))[DATE]?.t).toBe(HAND_PICKED);
  });
});

describe('Workout tab: unticking every set', () => {
  const tickLabel = 'Mark Barbell Bench Press set 1 done';

  it('deletes the lift record (a tombstone) when there was no earlier session', async () => {
    const db = await setup();
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 kg'), '40');
    await fireEvent.changeText(screen.getByLabelText('Barbell Bench Press set 1 reps'), '9');
    await press(tickLabel);
    await waitFor(() => expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').date).toBe(DATE));
    await press(tickLabel);
    await waitFor(() => expect(JSON.parse(db.rows.get('lift_stats:Barbell Bench Press') as string).deleted_at).toMatch(/Z$/));
    // The tombstone is skipped on load: the lift reads as never done.
    await screen.unmount();
    await mount(db);
    await screen.findByText('Push B');
    expect(screen.getAllByText('First time: find your weight').length).toBeGreaterThan(0);
  });

  it('restores the session before when there was one', async () => {
    const db = await setup({ lifts: { 'Barbell Bench Press': 60 } });
    await fireEvent.press(await screen.findByLabelText('Start Push B'));
    await screen.findByText('Push B');
    await press(tickLabel);
    await waitFor(() => expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').date).toBe(DATE));
    await press(tickLabel);
    await waitFor(() => expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press').date).toBe('2026-10-05'));
    expect(stored<LiftRecord>(db, 'lift_stats:Barbell Bench Press')).toMatchObject({ n: 2, sets: [{ w: 60 }, { w: 60 }, { w: 60 }] });
    expect(screen.getByText('Suggested: 62.5 kg × 6–10 reps')).toBeTruthy();
  });
});

describe('Workout tab: the Today note', () => {
  it('says what a stored recovery week or re-entry changes, from core’s codes', async () => {
    const db = await setup();
    const w = { id: null, version: 0, updated_at: '2026-10-08T05:00:00Z', deleted_at: null, date: DATE, template: 'Push B', base: 'Push B', where: null, cardio_min: null, ci_choice: null, exercises: [{ name: 'Pec Deck Fly', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }] };
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, mods: { light: true, short: false, where: 'gym', deload: true, reentry: 0 } }));
    await screen.unmount();
    await mount(db);
    // A recovery week wins over "lighter session".
    expect(await screen.findByText('Today: recovery week: fewer sets, about 10% lighter.')).toBeTruthy();
    await screen.unmount();
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, mods: { light: false, short: true, where: 'dumbbells', deload: false, reentry: 0.3 } }));
    await mount(db);
    expect(await screen.findByText('Today: easing back in: about 30% lighter; short session: main exercises only; dumbbells-only version.')).toBeTruthy();
  });
});
