import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { HAND_PICKED, ROUTINE_MAX_LIVE, planned, recoveryWeek } from '@plate-and-bar/core';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { createRoutine, deleteRoutine, loadRoutines, type RoutineExercise } from '../src/db/routines';
import { loadSessionLog, loadSets, loadWorkout, saveWorkout } from '../src/db/workouts';
import { saveProfile } from '../src/db/records';
import { saveExclusion, type ExclusionRecord } from '../src/db/rules';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { MY_ROUTINES as T, ROUTINE_COPY } from '../src/workout/copy';
import { press, tickFirstSets } from './disclosure-helpers';
import { withProfile } from './helpers';
import { openDb } from './sync-helpers';

// "My routines" on the Workout start screen: list, rename, delete with undo, start (#1184).
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const UPPER: RoutineExercise[] = [{ name: 'Lat Pulldown', sets: 4 }, { name: 'Barbell Bench Press', sets: 2 }, { name: 'Pec Deck Fly', sets: 5 }];

type Db = Awaited<ReturnType<typeof openDb>>;
async function mount(seed?: (db: Db) => Promise<void>, settings = defaultSettings('2026-10-08T00:00:00Z')) {
  const db = await openDb();
  await saveSettings(db as never, settings);
  await saveProfile(db as never, { ...profile, where: 'gym' });
  await seed?.(db);
  await render(withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />));
  return db;
}
const counts = async (db: Db) => {
  const n: Record<string, number> = {};
  for (const s of await loadSets(db as never, DATE)) if (!s.deleted_at && s.kind === 'work') n[s.exercise] = (n[s.exercise] ?? 0) + 1;
  return n;
};

describe('My routines section', () => {
  it('is hidden with no routines', async () => {
    await mount();
    await screen.findByLabelText('Start Push B');
    expect(screen.queryByText(T.title)).toBeNull();
  });

  it('is shown beside the plan, each row with name, exercise count and Start', async () => {
    await mount((db) => createRoutine(db as never, 'Upper', UPPER).then(() => undefined));
    expect(await screen.findByText(T.title)).toBeTruthy();
    expect(screen.getByText('Upper')).toBeTruthy();
    expect(screen.getByText('3 exercises')).toBeTruthy();
    expect(screen.getByLabelText('Start Upper')).toBeTruthy();
    expect(screen.getByLabelText('Start Push B')).toBeTruthy(); // the plan is still there
  });

  it('hides a deleted routine and shows no section when it was the last', async () => {
    await mount(async (db) => void (await deleteRoutine(db as never, (await createRoutine(db as never, 'Upper', UPPER)).id as string)));
    await screen.findByLabelText('Start Push B');
    expect(screen.queryByText(T.title)).toBeNull();
  });
});

describe('Starting a routine', () => {
  it('creates a hand-picked session with the routine’s names and stored set counts', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    const w = await loadWorkout(db as never, DATE);
    expect(w).toMatchObject({ template: HAND_PICKED, base: null, ci_choice: null });
    expect(w!.exercises.map((e) => e.name)).toEqual(['Lat Pulldown', 'Barbell Bench Press', 'Pec Deck Fly']);
    expect(await counts(db)).toEqual({ 'Lat Pulldown': 4, 'Barbell Bench Press': 2, 'Pec Deck Fly': 5 }); // no 3 floor, no 5 cap
  });

  it('applies the recovery week to the stored counts', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined), { ...defaultSettings('2026-10-08T00:00:00Z'), adjustments: { deload: recoveryWeek(DATE) } });
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    expect(await counts(db)).toEqual({ 'Lat Pulldown': 3, 'Barbell Bench Press': 2, 'Pec Deck Fly': 3 });
    expect((await loadWorkout(db as never, DATE))!.mods).toMatchObject({ deload: true });
  });

  it('applies a lighter-session check-in: one set fewer above 2', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await press('Sleep last night: Poor');
    await press('Lighter session');
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    expect(await counts(db)).toEqual({ 'Lat Pulldown': 3, 'Barbell Bench Press': 2, 'Pec Deck Fly': 4 });
  });

  it('flags a name the library lacks and one the rules exclude, keeps them, and lets the user remove them', async () => {
    const rule: ExclusionRecord = { id: 'r1', version: 0, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Pec Deck Fly', scope: 'exercise', key: 'Pec Deck Fly', reason: 'dislike', created: '2026-10-01', until: null, to: { 'Pec Deck Fly': null }, done: false };
    const db = await mount(async (d) => {
      await createRoutine(d as never, 'Mixed', [{ name: 'Lat Pulldown', sets: 3 }, { name: 'Retired Machine Thing', sets: 3 }, { name: 'Pec Deck Fly', sets: 3 }]);
      await saveExclusion(d as never, rule);
    });
    await press('Start Mixed');
    expect(await screen.findByText(T.unknown('Retired Machine Thing'))).toBeTruthy();
    expect(screen.getByText(T.excluded('Pec Deck Fly'))).toBeTruthy();
    expect(Object.keys(await counts(db))).toEqual(expect.arrayContaining(['Lat Pulldown', 'Retired Machine Thing', 'Pec Deck Fly']));
    await press(T.removeLabel('Retired Machine Thing'));
    await waitFor(() => expect(screen.queryByText(T.unknown('Retired Machine Thing'))).toBeNull());
    expect((await loadWorkout(db as never, DATE))!.exercises.map((e) => e.name)).not.toContain('Retired Machine Thing');
    expect(screen.getByText(T.excluded('Pec Deck Fly'))).toBeTruthy();
  });

  it('flags nothing for a routine of known, allowed exercises', async () => {
    await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    expect(screen.queryByText(/no longer in the exercise library|excluded by your exercise rules/)).toBeNull();
  });

  it('never overwrites a session already stored for the day: the stored one shows, nothing is replaced', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await screen.findByLabelText('Start Upper');
    // Another device stores today's session after this screen read the day.
    await saveWorkout(db as never, { id: 'w-other', version: 1, updated_at: '2026-10-08T09:00:00Z', deleted_at: null, date: DATE, template: 'Push B', base: 'Push B', where: null, mods: {}, exercises: [{ name: 'Overhead Cable Extension', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, feel: null } as never], ci_choice: null, cardio_min: null });
    await press('Start Upper');
    await waitFor(async () => expect((await loadWorkout(db as never, DATE))!.template).toBe('Push B'));
    expect((await loadWorkout(db as never, DATE))!.exercises.map((e) => e.name)).toEqual(['Overhead Cable Extension']);
  });

  it('leaves the next-workout rotation alone: the routine day is logged as hand-picked and skipped by sequence mode', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined), { ...defaultSettings('2026-10-08T00:00:00Z'), adjustments: { mode: 'sequence' } });
    const before = planned('2026-10-09', { profile, sessions: {}, mode: 'sequence' });
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    expect(await tickFirstSets()).toBeGreaterThan(0);
    await waitFor(async () => expect((await loadSessionLog(db as never))[DATE]?.t).toBe(HAND_PICKED));
    expect(planned('2026-10-09', { profile, sessions: await loadSessionLog(db as never), mode: 'sequence' })).toBe(before);
  });

  it('works offline: no network is touched, the session and the routine are stored on the device', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockRejectedValue(new Error('offline') as never);
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await loadWorkout(db as never, DATE)).not.toBeNull();
    expect(await loadRoutines(db as never)).toHaveLength(1);
    fetchSpy.mockRestore();
  });
});

describe('Rename and delete', () => {
  const edit = async (name: string) => press(T.moreLabel(name));

  it('renames, then shows the new name', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await edit('Upper');
    await fireEvent.changeText(screen.getByLabelText(T.renameLabel), '  Upper A  ');
    await press(T.rename);
    expect(await screen.findByText(T.renamed('Upper A'))).toBeTruthy();
    expect(screen.getByLabelText('Start Upper A')).toBeTruthy();
    expect((await loadRoutines(db as never))[0]!.name).toBe('Upper A');
  });

  it('refuses a blank name and a 61-character one with an announced error, and keeps the old name', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await edit('Upper');
    for (const bad of ['   ', 'x'.repeat(61), '​​']) {
      await fireEvent.changeText(screen.getByLabelText(T.renameLabel), bad);
      await press(T.rename);
      const err = await screen.findByText(ROUTINE_COPY.nameError(60));
      expect(screen.getByLabelText(T.renameLabel).props.accessibilityHint).toBe(ROUTINE_COPY.nameError(60));
      expect(err).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText(T.renameLabel), 'ok');
      expect(screen.queryByText(ROUTINE_COPY.nameError(60))).toBeNull();
    }
    expect((await loadRoutines(db as never))[0]!.name).toBe('Upper');
  });

  it('accepts exactly 60 code points', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await edit('Upper');
    await fireEvent.changeText(screen.getByLabelText(T.renameLabel), '🏋'.repeat(60));
    await press(T.rename);
    await waitFor(async () => expect((await loadRoutines(db as never))[0]!.name).toBe('🏋'.repeat(60)));
  });

  it('deletes with an Undo that brings back the same id', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    const id = (await loadRoutines(db as never))[0]!.id;
    await edit('Upper');
    await press(T.delete);
    expect(await screen.findByText(T.deleted('Upper'))).toBeTruthy();
    expect(await loadRoutines(db as never)).toHaveLength(0);
    expect(screen.queryByLabelText('Start Upper')).toBeNull();
    await press(T.undoLabel('Upper'));
    expect(await screen.findByLabelText('Start Upper')).toBeTruthy();
    expect((await loadRoutines(db as never)).map((r) => r.id)).toEqual([id]);
    expect(screen.queryByText(T.deleted('Upper'))).toBeNull();
  });

  it('Undo respects the 100 cap: refused with a message, the routine stays deleted', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await edit('Upper');
    await press(T.delete);
    await screen.findByText(T.deleted('Upper'));
    for (let i = 0; i < ROUTINE_MAX_LIVE; i++) await createRoutine(db as never, `R${i}`, UPPER);
    await press(T.undoLabel('Upper'));
    expect(await screen.findByText(ROUTINE_COPY.tooMany(ROUTINE_MAX_LIVE))).toBeTruthy();
    expect((await loadRoutines(db as never)).some((r) => r.name === 'Upper')).toBe(false);
  });
});
