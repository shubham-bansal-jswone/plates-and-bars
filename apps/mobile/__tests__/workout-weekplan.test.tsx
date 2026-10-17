import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { blankRow, setRecord } from '../src/workout/model';
import type { Workout } from '../src/workout/types';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// Thursday 2026-10-08 is Push B on the 6-day split. Monday 2026-10-12 is Push A there, Upper A on a 4-day week plan.
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const NEXT_MONDAY = () => new Date(2026, 9, 12, 10, 0, 0);
const FOUR = { start: '2026-10-12', list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] };

type Db = ReturnType<typeof memoryDb>;
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
async function seeded(adjustments: Record<string, unknown>, rows: (db: Db) => Promise<void> = async () => {}) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), adjustments });
  await rows(db);
  return db;
}
const water = () => screen.getByLabelText(/^0 of about [\d.]+ litres$/).props.accessibilityLabel as string;

describe('Workout and water follow the week plan and sequence mode (#681)', () => {
  it('shows the week plan day and its list on Workout', async () => {
    const db = await seeded({ weekPlan: FOUR });
    await render(withProfile(db, <WorkoutScreen db={db} now={NEXT_MONDAY} />));
    expect(await screen.findByText('Upper A day')).toBeTruthy();
    expect(screen.getByText('This week’s 4-day plan.')).toBeTruthy();
    expect(screen.getByLabelText('Start Upper A')).toBeTruthy();
    expect(screen.getByLabelText('Start Lower B')).toBeTruthy();
    expect(screen.queryByLabelText('Start Push A')).toBeNull();
  });

  it('ignores a week plan for another week', async () => {
    const db = await seeded({ weekPlan: { ...FOUR, start: '2026-10-05' } });
    await render(withProfile(db, <WorkoutScreen db={db} now={NEXT_MONDAY} />));
    expect(await screen.findByText('Push A day')).toBeTruthy();
  });

  it('runs in order in sequence mode: the template after the last one done, even on another weekday', async () => {
    const db = await seeded({ mode: 'sequence' }, async (d) => {
      const w: Workout = { id: null, version: 0, updated_at: 'x', deleted_at: null, date: '2026-10-05', template: 'Pull A', base: 'Pull A', where: 'gym', cardio_min: null, mods: {}, exercises: [{ name: 'Lat Pulldown', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], ci_choice: null };
      await saveWorkout(d, w);
      const ex = { name: 'Lat Pulldown', part: 1 as const, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: [{ ...blankRow(), done: true }], ramp: [] };
      await saveSet(d, '2026-10-05', setRecord(ex, 'work', 0, THURSDAY()));
    });
    await render(withProfile(db, <WorkoutScreen db={db} now={NEXT_MONDAY} />));
    expect(await screen.findByText('Legs A day')).toBeTruthy();
  });

  it('changes the water target through the same plan: a week-plan day on Sunday counts as training', async () => {
    // 2026-10-11 is a Sunday: rest on the normal week, but a week plan starting 2026-10-05 plans a session.
    const SUNDAY = () => new Date(2026, 9, 11, 10, 0, 0);
    const none = await seeded({});
    await render(withProfile(none, <FoodScreen db={none} now={SUNDAY} />));
    await screen.findByText('Water today');
    const rest = water();
    await screen.unmount();
    const db = await seeded({ weekPlan: { start: '2026-10-05', list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] } });
    await render(withProfile(db, <FoodScreen db={db} now={SUNDAY} />));
    await screen.findByText('Water today');
    await waitFor(() => expect(water()).not.toBe(rest));
  });

  it('"Use a 4-day plan next week" changes next week\'s Workout day', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const { unmount } = await render(withProfile(db, <ProgressScreen db={db} now={THURSDAY} />));
    await fireEvent.press(await screen.findByLabelText('Use a 4-day plan next week'));
    await waitFor(() => expect(JSON.parse(db.rows.get('user_settings:me')!).adjustments.weekPlan).toEqual(FOUR));
    await unmount();
    await render(withProfile(db, <WorkoutScreen db={db} now={NEXT_MONDAY} />));
    expect(await screen.findByText('Upper A day')).toBeTruthy();
  });
});
