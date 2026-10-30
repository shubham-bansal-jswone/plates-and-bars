import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
import { press, pressDay, tickFirstSets } from './disclosure-helpers';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { focusNode } from '../src/labelscan/focus';
import { Platform } from 'react-native';
import { renameRoutine, undoDeleteRoutine } from '../src/db/routines';
import { withProfile } from './helpers';
import { openDb } from './sync-helpers';

// "My routines" on the Workout start screen: list, rename, delete with undo, start (#1184).
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

jest.mock('../src/db/routines', () => {
  const actual = jest.requireActual('../src/db/routines');
  return { ...actual, undoDeleteRoutine: jest.fn(actual.undoDeleteRoutine), loadRoutines: jest.fn(actual.loadRoutines) };
});
jest.mock('../src/labelscan/focus', () => ({ ...jest.requireActual('../src/labelscan/focus'), focusNode: jest.fn() }));
const focused = () => jest.mocked(focusNode).mock.calls.at(-1)?.[0] as { props?: { accessibilityLabel?: string; accessibilityRole?: string } } | undefined;
beforeEach(() => (jest.mocked(focusNode).mockClear(), jest.mocked(undoDeleteRoutine).mockClear()));

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
    expect((await screen.findAllByText(ROUTINE_COPY.tooMany(ROUTINE_MAX_LIVE))).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(T.undoLabel('Upper'))).toBeTruthy(); // the Undo row stays: delete another routine and try again
    expect((await loadRoutines(db as never)).some((r) => r.name === 'Upper')).toBe(false);
  });
});

const TWO = (d: Db) => createRoutine(d as never, 'Alpha', UPPER).then(() => createRoutine(d as never, 'Beta', UPPER)).then(() => undefined);

describe('Undo survives the section being hidden', () => {
  const del = async (name: string) => {
    await press(T.moreLabel(name));
    await press(T.delete);
    await screen.findByText(T.deleted(name));
  };

  it('delete A, open Pick exercises, add one, Back to workouts: the Undo row is still there and restores A', async () => {
    const db = await mount(TWO);
    await screen.findByLabelText('Start Beta');
    await del('Alpha');
    await pressDay('Pick exercises');
    await press('Add Lat Pulldown from Pull A');
    expect(screen.queryByText(T.title)).toBeNull(); // hidden while the pick list is open
    await press('Back to workouts');
    expect(await screen.findByLabelText('Start Beta')).toBeTruthy();
    expect(screen.getByText(T.deleted('Alpha'))).toBeTruthy();
    await press(T.undoLabel('Alpha'));
    expect(await screen.findByLabelText('Start Alpha')).toBeTruthy();
    expect(screen.queryByText(T.deleted('Alpha'))).toBeNull();
    expect((await loadRoutines(db as never)).map((r) => r.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('is hidden while a workout preview is open and back after', async () => {
    await mount(TWO);
    await screen.findByLabelText('Start Beta');
    await pressDay('Choose Pull A');
    expect(screen.queryByText(T.title)).toBeNull();
    expect(screen.queryByLabelText('Start Beta')).toBeNull();
    await press('Back to workouts');
    expect(await screen.findByLabelText('Start Beta')).toBeTruthy();
  });

  it('a second delete replaces the pending Undo; a routine revived on another device clears it', async () => {
    const db = await openDb();
    await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db as never, { ...profile, where: 'gym' });
    await TWO(db);
    const beta = (await loadRoutines(db as never)).find((r) => r.name === 'Beta')!;
    const at = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />)}</SyncContext.Provider>;
    const view = await render(at(0));
    await screen.findByLabelText('Start Beta');
    await del('Alpha');
    await del('Beta');
    expect(screen.queryByText(T.deleted('Alpha'))).toBeNull();
    expect(screen.getByText(T.deleted('Beta'))).toBeTruthy();
    await undoDeleteRoutine(db as never, beta.id as string); // another device brought it back
    await view.rerender(at(1));
    expect(await screen.findByLabelText('Start Beta')).toBeTruthy();
    expect(screen.queryByText(T.deleted('Beta'))).toBeNull();
  });
});

describe('A stale reload never undoes a delete', () => {
  it('a sync reload still in flight when Delete lands, finishing last: Alpha stays gone and the Undo row stays', async () => {
    const db = await openDb();
    await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db as never, { ...profile, where: 'gym' });
    await TWO(db);
    const at = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />)}</SyncContext.Provider>;
    const view = await render(at(0));
    await screen.findByLabelText('Start Alpha');
    const stale = await jest.requireActual('../src/db/routines').loadRoutines(db as never); // read before the delete: still has Alpha
    let release!: () => void;
    jest.mocked(loadRoutines).mockImplementationOnce(() => new Promise((r) => (release = () => r(stale))));
    await view.rerender(at(1)); // the sync reload starts and waits
    await press(T.moreLabel('Alpha'));
    await press(T.delete);
    await screen.findByText(T.deleted('Alpha'));
    await act(async () => release()); // the stale read finishes last
    expect(screen.queryByLabelText('Start Alpha')).toBeNull();
    expect(screen.getByText(T.deleted('Alpha'))).toBeTruthy();
  });
});

describe('Delete and Undo keep the Edit buttons in the tab order (web)', () => {
  const os = Platform.OS;
  const attrs = new WeakMap<object, Map<string, string>>();
  // Stands in for the DOM element: a button already has tabindex 0, a heading has none.
  const dom = (node: { props?: { accessibilityRole?: string } }) => {
    const a = attrs.get(node) ?? new Map(node.props?.accessibilityRole === 'button' ? [['tabindex', '0']] : []);
    attrs.set(node, a);
    return { hasAttribute: (n: string) => a.has(n), setAttribute: (n: string, v: string) => void a.set(n, v), matches: () => false, focus: () => undefined };
  };
  beforeEach(() => {
    Platform.OS = 'web';
    jest.mocked(focusNode).mockImplementation((n) => jest.requireActual('../src/labelscan/focus').focusNode(dom(n as never)));
  });
  afterEach(() => {
    Platform.OS = os;
    jest.mocked(focusNode).mockReset();
  });
  const tabindex = (n: unknown) => attrs.get(n as object)?.get('tabindex');

  it('after Delete the next Edit keeps its tab stop; after Undo so does the restored Edit', async () => {
    await mount(TWO);
    await press(T.moreLabel('Alpha'));
    await press(T.delete);
    await screen.findByText(T.deleted('Alpha'));
    await waitFor(() => expect(focused()?.props?.accessibilityLabel).toBe(T.moreLabel('Beta')));
    expect(tabindex(focused())).toBe('0');
    await press(T.undoLabel('Alpha'));
    await waitFor(() => expect(focused()?.props?.accessibilityLabel).toBe(T.moreLabel('Alpha')));
    expect(tabindex(focused())).toBe('0');
  });

  it('the section heading still becomes focusable by script', async () => {
    await mount((d) => createRoutine(d as never, 'Solo', UPPER).then(() => undefined));
    await press(T.moreLabel('Solo'));
    await press(T.delete);
    await waitFor(() => expect(focused()?.props?.accessibilityRole).toBe('header'));
    expect(tabindex(focused())).toBe('-1');
  });
});

describe('Delete and Undo: announcement, focus, double tap', () => {
  it('announces the delete with Undo available, through the app announcer', async () => {
    await mount(TWO);
    await press(T.moreLabel('Alpha'));
    await press(T.delete);
    expect(await screen.findByText(T.deletedAnnounce('Alpha'))).toBeTruthy();
    expect(T.deletedAnnounce('Alpha')).toBe('Deleted “Alpha”. Undo available.');
  });

  it('after Delete moves focus to the next row’s Edit; after the last one, to the section heading', async () => {
    await mount(TWO);
    await press(T.moreLabel('Alpha'));
    await press(T.delete);
    await screen.findByText(T.deleted('Alpha'));
    await waitFor(() => expect(focused()?.props?.accessibilityLabel).toBe(T.moreLabel('Beta')));
    jest.mocked(focusNode).mockClear();
    await press(T.moreLabel('Beta'));
    await press(T.delete);
    await screen.findByText(T.deleted('Beta'));
    await waitFor(() => expect(focused()?.props?.accessibilityRole).toBe('header'));
  });

  it('after Undo moves focus to the restored row’s Edit, and announces Restored once even on a double tap', async () => {
    const db = await mount(TWO);
    await press(T.moreLabel('Alpha'));
    await press(T.delete);
    await screen.findByText(T.deleted('Alpha'));
    jest.mocked(focusNode).mockClear();
    const undo = screen.getByLabelText(T.undoLabel('Alpha'));
    let release!: () => void;
    const real = jest.requireActual('../src/db/routines').undoDeleteRoutine;
    jest.mocked(undoDeleteRoutine).mockImplementationOnce((...a) => new Promise<void>((r) => (release = r)).then(() => real(...a)));
    await fireEvent.press(undo);
    await fireEvent.press(undo); // the first revive is still running
    expect(undoDeleteRoutine).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findAllByText(T.restored('Alpha'))).toHaveLength(1);
    await waitFor(() => expect(focused()?.props?.accessibilityLabel).toBe(T.moreLabel('Alpha')));
    expect((await loadRoutines(db as never)).filter((r) => r.name === 'Alpha')).toHaveLength(1);
  });
});

describe('Reload after a sync pull, rename field wiring', () => {
  it('re-reads the list when sync bumps the data version (a rename done straight in the database)', async () => {
    const db = await openDb();
    await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db as never, { ...profile, where: 'gym' });
    const r = await createRoutine(db as never, 'Upper', UPPER);
    const at = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />)}</SyncContext.Provider>;
    const view = await render(at(0));
    expect(await screen.findByLabelText('Start Upper')).toBeTruthy();
    await renameRoutine(db as never, r.id as string, 'Pulled name');
    expect(screen.queryByLabelText('Start Pulled name')).toBeNull();
    await view.rerender(at(1));
    expect(await screen.findByLabelText('Start Pulled name')).toBeTruthy();
  });

  it('ties the rename field to its error message', async () => {
    await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await press(T.moreLabel('Upper'));
    await fireEvent.changeText(screen.getByLabelText(T.renameLabel), '   ');
    await press(T.rename);
    const msg = await screen.findByText(ROUTINE_COPY.nameError(60));
    expect(screen.getByLabelText(T.renameLabel).props['aria-describedby']).toBe(msg.props.nativeID);
    expect(msg.props.nativeID).toBeTruthy();
  });
});

describe('Hand-picked sessions flag missing and excluded exercises', () => {
  const rule: ExclusionRecord = { id: 'r1', version: 0, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Lat Pulldown', scope: 'exercise', key: 'Lat Pulldown', reason: 'dislike', created: '2026-10-01', until: null, to: { 'Lat Pulldown': null }, done: false };

  it('flags an excluded exercise on a session made with Pick exercises, not only from a routine', async () => {
    const db = await mount();
    await pressDay('Pick exercises');
    await press('Add Lat Pulldown from Pull A');
    await press('Start this exercise');
    await screen.findByText(HAND_PICKED);
    expect(screen.queryByText(T.excluded('Lat Pulldown'))).toBeNull();
    await saveExclusion(db as never, rule);
    await screen.unmount();
    await render(withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />));
    expect(await screen.findByText(T.excluded('Lat Pulldown'))).toBeTruthy();
  });

  it('flags nothing on a planned session even when a rule is added for one of its exercises afterwards', async () => {
    const db = await mount();
    await press('Start Push B');
    await screen.findByText('Push B');
    await saveExclusion(db as never, { ...rule, name: 'Barbell Bench Press', key: 'Barbell Bench Press', to: { 'Barbell Bench Press': null } });
    await screen.unmount();
    await render(withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />));
    await screen.findByText('Push B');
    expect(screen.queryByText(/excluded by your exercise rules|no longer in the exercise library/)).toBeNull();
  });
});

describe('Starting a routine keeps the hand-picked start’s choices', () => {
  it('stores today’s “training away from your gym” choice on the session, as Start this exercise does', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Upper', UPPER).then(() => undefined));
    await press('Training away from your gym?');
    await press('Dumbbells only');
    await press('Start Upper');
    await screen.findByText(HAND_PICKED);
    expect((await loadWorkout(db as never, DATE))!.where).toBe('dumbbells');
  });
});
