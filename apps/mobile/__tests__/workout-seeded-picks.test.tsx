import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { loadSessionLog } from '../src/db/workouts';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// Thursday 2026-10-08 is Push B on the 6-day split.
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';

async function setup() {
  const db = memoryDb();
  await saveProfile(db, buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1)));
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  return db;
}
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const workout = (db: ReturnType<typeof memoryDb>) => JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout;
const setCounts = (db: ReturnType<typeof memoryDb>) => {
  const n: Record<string, number> = {};
  for (const s of db.sets.values()) {
    const name = (JSON.parse(s.data) as { exercise: string }).exercise;
    n[name] = (n[name] ?? 0) + 1;
  }
  return n;
};

describe('Picks seeded from a workout preview keep its base and adjustments (#1020)', () => {
  it('a Lighter session check-in stores the lighter mods and trimmed set counts', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    await press('Sleep last night: Poor');
    await press('Lighter session');
    await press('Pick exercises');
    await press('Start these exercises');
    await screen.findByText('Pull A');
    const w = workout(db);
    expect(w).toMatchObject({ base: 'Pull A', ci_choice: 'light' });
    expect(w.mods).toMatchObject({ light: true });
    expect(Object.keys(setCounts(db))).toContain('Lat Pulldown');
    expect(Math.max(...Object.values(setCounts(db)))).toBeLessThanOrEqual(2);
  });

  it('stores the previewed workout as the base, so the rotation counts it', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    await press('Pick exercises');
    await press('Start these exercises');
    await screen.findByText('Pull A');
    const w = workout(db);
    expect(w.base).toBe('Pull A');
    expect(w.template).not.toBe('Session');
    await fireEvent.changeText(screen.getByLabelText('Lat Pulldown set 1 kg'), '50');
    await fireEvent.changeText(screen.getByLabelText('Lat Pulldown set 1 reps'), '8');
    await press('Mark Lat Pulldown set 1 done');
    await waitFor(async () => expect((await loadSessionLog(db))[DATE]).toMatchObject({ t: 'Pull A' }));
  });

  it('removing one seeded exercise and adding one from another workout keeps the base', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    await press('Pick exercises');
    await press('Add Barbell Bench Press from Push B');
    await press('Remove Lat Pulldown from your exercises');
    await press('Start these exercises');
    await screen.findByText('Pull A');
    const w = workout(db);
    expect(w.base).toBe('Pull A');
    const names = w.exercises.map((e) => e.name);
    expect(names).not.toContain('Lat Pulldown');
    expect(names[names.length - 1]).toBe('Barbell Bench Press');
  });

  it('a fully hand-picked session has no base and stores Session', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Sleep last night: Poor');
    await press('Lighter session');
    await press('Pick exercises');
    await press('Add Barbell Bench Press');
    await press('Start this exercise');
    await screen.findByText('Session');
    expect(workout(db)).toMatchObject({ template: 'Session', base: null, mods: {}, ci_choice: 'light' });
    expect(setCounts(db)['Barbell Bench Press']).toBe(3);
  });

  it('going back drops the seed: later hand picks have no base', async () => {
    const db = await setup();
    await screen.findByText('Push B day');
    await press('Choose Pull A');
    await press('Pick exercises');
    await press('Back to workouts');
    await press('Pick exercises');
    await press('Add Barbell Bench Press');
    await press('Start this exercise');
    await screen.findByText('Session');
    expect(workout(db)).toMatchObject({ template: 'Session', base: null });
  });
});
