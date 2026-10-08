import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { catalog } from '../src/workout/catalog';
import type { LiftRecord } from '@plate-and-bar/core';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
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

async function setup(opts: { now?: () => Date; lifts?: Record<string, number>; hist?: Record<string, number[]>; focus?: string[] } = {}) {
  const db = memoryDb();
  await saveProfile(db, profile());
  for (const [name, w] of Object.entries(opts.lifts ?? {})) await seedLift(db, name, w, opts.hist?.[name]);
  await mount(db, opts);
  return db;
}

async function mount(db: Db, opts: { now?: () => Date; focus?: string[] } = {}) {
  await render(withProfile(db, <WorkoutScreen db={db} now={opts.now ?? THURSDAY} focus={opts.focus} />));
}

/** A previous session in core's lift record shape: 3 sets at the top of the range, so the suggestion is one step up. */
async function seedLift(db: Db, name: string, w: number, scores?: number[]) {
  const set = { w, r: catalog.meta[name]?.rep_high ?? 12, rate: 'right' as const };
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

const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const stored = <T,>(db: Db, key: string) => JSON.parse(db.rows.get(key) as string) as T;
const storedSets = (db: Db) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);
const placeholder = (label: string) => screen.getByLabelText(label).props.placeholder as string;

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
    expect(screen.getByLabelText('Start Pull A')).toBeTruthy();
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

  it('the check-in choice is stored as ci_choice and makes the session lighter', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Sleep last night: Poor');
    expect(screen.getByText(/Lighter session suggested/)).toBeTruthy();
    await press('Lighter session');
    expect(screen.getByText(/2 sets each/)).toBeTruthy();
    await press('Start Push B');
    await screen.findByText('Push B');
    expect(stored<Workout>(db, `workouts:${DATE}`)).toMatchObject({ ci_choice: 'light', mods: { light: true } });
    expect(storedSets(db)).toHaveLength(10);
    expect(screen.getByText(/Today: lighter session/)).toBeTruthy();
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
  const lifts = { 'Barbell Bench Press': 60, 'Machine Shoulder Press': 30, 'Pec Deck Fly': 25, 'Cable Lateral Raise': 10, 'Overhead Cable Extension': 20 };

  async function started(opts: Parameters<typeof setup>[0] = {}) {
    const db = await setup({ lifts, ...opts });
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    return db;
  }

  it('shows core’s suggestion, target and warm-up line', async () => {
    await started();
    // 3 sets of 10 at 60 kg on a 6–10 barbell lift: add one 2.5 kg step and aim for the bottom of the range.
    expect(screen.getByText('Suggested: 62.5 kg × 6–10 reps')).toBeTruthy();
    expect(placeholder('Barbell Bench Press set 1 kg')).toBe('62.5');
    expect(placeholder('Barbell Bench Press set 1 reps')).toBe('6');
    expect(screen.getByText(/8 reps at 32.5 kg, then 4 at 47.5 kg/)).toBeTruthy();
  });

  it('ticking an empty set takes the target, writes the set and the lift stat, and starts the rest timer', async () => {
    const db = await started();
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

    expect(screen.getByText('Rest 2:30')).toBeTruthy();
    expect(screen.getByText('Next: set 2 of Barbell Bench Press')).toBeTruthy();
    expect(screen.getByLabelText('Mark Barbell Bench Press set 1 done').props.accessibilityState.checked).toBe(true);
    expect(screen.getByText('1 of 15 sets done, 375 kg lifted')).toBeTruthy();
  });

  it('refuses to tick a first-time set with nothing to fill from', async () => {
    const db = await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
    await press('Mark Barbell Bench Press set 1 done');
    expect(await screen.findByText('Enter the weight and reps first.')).toBeTruthy();
    expect(storedSets(db).some((s) => s.done)).toBe(false);
  });

  it('rating a set stores it and adjusts the next target (Easy adds a step)', async () => {
    const db = await started();
    await press('Mark Barbell Bench Press set 1 done');
    await press('Barbell Bench Press set 1: Easy');
    await waitFor(() => expect(storedSets(db).find((s) => s.rate)?.rate).toBe('easy'));
    expect(placeholder('Barbell Bench Press set 2 kg')).toBe('65');
    await press('Barbell Bench Press set 1 rated Easy. Change rating');
    await waitFor(() => expect(storedSets(db).every((s) => s.rate === null)).toBe(true));
  });

  it('asks about form after the last set and stores the answer on the exercise', async () => {
    const db = await started();
    for (const j of [1, 2, 3]) await press(`Mark Overhead Cable Extension set ${j} done`);
    await press('Overhead Cable Extension form: Not really');
    await waitFor(() => expect(stored<Workout>(db, `workouts:${DATE}`).exercises[4]?.form).toBe('no'));
    expect(stored<LiftRecord>(db, 'lift_stats:Overhead Cable Extension').form).toBe('no');
  });

  it('keeps what was ticked after the app is reopened', async () => {
    const db = await started();
    await fireEvent.changeText(screen.getByLabelText('Pec Deck Fly set 1 kg'), '27.5');
    await fireEvent.changeText(screen.getByLabelText('Pec Deck Fly set 1 reps'), '11');
    await press('Mark Pec Deck Fly set 1 done');
    await waitFor(() => expect(storedSets(db).find((s) => s.done)).toBeTruthy());
    await screen.unmount();
    await mount(db);
    await screen.findByText('Push B');
    expect(screen.getByLabelText('Mark Pec Deck Fly set 1 done').props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText('Pec Deck Fly set 1 kg').props.value).toBe('27.5');
    expect(screen.getByLabelText('Pec Deck Fly set 1 reps').props.value).toBe('11');
    expect(screen.queryByLabelText('Start Push B')).toBeNull();
  });

  it('opens the how-to card from content (long keys)', async () => {
    await started();
    await press('How to do Barbell Bench Press');
    const card = catalog.cards['Barbell Bench Press']!;
    expect(await screen.findByText(`• ${card.key_cues[0]}`)).toBeTruthy();
    expect(screen.getByText(`1. ${card.setup[0]}`)).toBeTruthy();
    expect(screen.getByText(`• ${card.common_mistakes[0]}`)).toBeTruthy();
    expect(screen.getByText(card.where_to_feel, { exact: false })).toBeTruthy();
  });

  it('offers a second session once every exercise has a done set, and adds it as part 2', async () => {
    const db = await started();
    for (const n of PUSH_B) await press(`Mark ${n} set 1 done`);
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
  it('starts a ramp, stores its sets as kind ramp, and the rated weight becomes the working target', async () => {
    const db = await setup();
    await press('Start Push B');
    await screen.findByText('Push B');
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
});

describe('Workout tab: personal best', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

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
