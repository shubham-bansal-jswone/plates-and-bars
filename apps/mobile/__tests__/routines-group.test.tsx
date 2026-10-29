import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { createRoutine, loadRoutines } from '../src/db/routines';
import { loadWorkout, saveWorkout } from '../src/db/workouts';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { ROUTINE_COPY as T } from '../src/workout/copy';
import { expand, press } from './disclosure-helpers';
import { withProfile } from './helpers';
import { openDb } from './sync-helpers';

// Saved routines keep supersets; a started routine gets fresh group ids (#1182 S6b, ADR 012).
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const GROUP = /^[A-Za-z0-9_-]{1,64}$/;

type Db = Awaited<ReturnType<typeof openDb>>;
async function mount(seed?: (db: Db) => Promise<void>) {
  const db = await openDb();
  await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
  await saveProfile(db as never, { ...profile, where: 'gym' });
  await seed?.(db);
  await render(withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />));
  return db;
}
const SUPERSET: { name: string; sets: number; group?: string }[] = [{ name: 'Lat Pulldown', sets: 3, group: 'a' }, { name: 'Barbell Bench Press', sets: 3, group: 'a' }, { name: 'Pec Deck Fly', sets: 3 }];

describe('Save as routine keeps the session’s groups', () => {
  it('a stored grouped session saves a routine whose members carry a group; the loose one has none', async () => {
    const db = await mount(async (d) => {
      await saveWorkout(d as never, { id: null, version: 0, updated_at: '2026-10-08T09:00:00Z', deleted_at: null, date: DATE, template: 'Push B', base: 'Push B', where: null, mods: {}, ci_choice: null, exercises: SUPERSET.map((e) => ({ name: e.name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...(e.group ? { group: e.group } : {}) })) } as never);
    });
    await screen.findByText('Push B');
    await press(T.action);
    await press(T.save);
    await waitFor(async () => expect(await loadRoutines(db)).toHaveLength(1));
    const [r] = await loadRoutines(db);
    const [a, b, c] = r!.exercises;
    expect(a!.group).toBeTruthy();
    expect(b!.group).toBe(a!.group);
    expect(c).not.toHaveProperty('group');
  });
});

describe('Starting a routine with a group', () => {
  const start = async () => {
    const db = await mount((d) => createRoutine(d as never, 'Sup', SUPERSET).then(() => undefined));
    await press('Start Sup');
    await waitFor(async () => expect(await loadWorkout(db as never, DATE)).not.toBeNull());
    return (await loadWorkout(db as never, DATE))!.exercises;
  };

  it('writes a fresh valid group id on the members and no group key on the loose exercise', async () => {
    const exs = await start();
    const [a, b, c] = exs;
    expect(a!.group).toMatch(GROUP);
    expect(b!.group).toBe(a!.group);
    expect(c).not.toHaveProperty('group');
  });

  it('two starts get different ids', async () => {
    const first = (await start())[0]!.group;
    cleanup();
    const second = (await start())[0]!.group;
    expect(first).toMatch(GROUP);
    expect(second).toMatch(GROUP);
    expect(second).not.toBe(first);
  });

  it('an ungrouped routine starts with no group key at all', async () => {
    const db = await mount((d) => createRoutine(d as never, 'Plain', [{ name: 'Lat Pulldown', sets: 3 }, { name: 'Pec Deck Fly', sets: 3 }]).then(() => undefined));
    await press('Start Plain');
    await waitFor(async () => expect(await loadWorkout(db as never, DATE)).not.toBeNull());
    for (const e of (await loadWorkout(db as never, DATE))!.exercises) expect(e).not.toHaveProperty('group');
  });
});

describe('Save as routine after Complete workout, with groups', () => {
  async function tick(name: string) {
    await expand(name);
    // A member of a superset names its set with the letter ("Lat Pulldown set 1, A1 kg").
    const set = `${name} set 1(, [A-Z]1)?`;
    await fireEvent.changeText(screen.getByLabelText(new RegExp(`^${set} kg`)), '10');
    await fireEvent.changeText(screen.getByLabelText(new RegExp(`^${set} reps`)), '10');
    await press(new RegExp(`^Mark ${set} done`));
  }
  async function setup(ticked: string[]) {
    const db = await openDb();
    await saveSettings(db as never, defaultSettings('2026-10-08T00:00:00Z'));
    await saveProfile(db as never, { ...profile, where: 'gym' });
    await createRoutine(db as never, 'Sup', SUPERSET);
    const ui = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db as never, <WorkoutScreen db={db as never} now={THURSDAY} />)}</SyncContext.Provider>;
    const view = await render(ui(0));
    await press('Start Sup');
    await screen.findByText('Session');
    for (const n of ticked) await tick(n);
    await press('Complete workout');
    await press('Confirm');
    await screen.findByText('Session done');
    return { db, view, ui };
  }
  const savedRoutine = async (db: Db) => {
    await press(T.action);
    await fireEvent.changeText(screen.getByLabelText(T.nameLabel), 'Copy');
    await press(T.save);
    await waitFor(async () => expect(await loadRoutines(db)).toHaveLength(2));
    return (await loadRoutines(db)).find((r) => r.name !== 'Sup')!.exercises;
  };

  it('dissolves a one-member group at Complete, so a no-change pull keeps the planned session', async () => {
    const { db, view, ui } = await setup(['Lat Pulldown']);
    expect((await loadWorkout(db as never, DATE))!.exercises.map((e) => e.group ?? null)).toEqual([null]);
    await view.rerender(ui(1));
    await waitFor(() => expect(screen.getByLabelText(T.action)).toBeTruthy());
    expect((await savedRoutine(db)).map((e) => e.name)).toEqual(['Lat Pulldown', 'Barbell Bench Press', 'Pec Deck Fly']);
  });

  it('a pull that changes only the grouping discards the plan: the live grouping is saved', async () => {
    const { db, view, ui } = await setup(['Lat Pulldown', 'Barbell Bench Press']);
    const wk = (await loadWorkout(db as never, DATE))!;
    expect(wk.exercises.map((e) => !!e.group)).toEqual([true, true]);
    await saveWorkout(db as never, { ...wk, exercises: wk.exercises.map((e) => ({ ...e, group: null })) });
    await view.rerender(ui(1));
    await waitFor(() => expect(screen.getByLabelText(T.action)).toBeTruthy());
    const rows = await savedRoutine(db);
    expect(rows.map((e) => e.name)).toEqual(['Lat Pulldown', 'Barbell Bench Press']);
    for (const e of rows) expect(e).not.toHaveProperty('group');
  });
});
