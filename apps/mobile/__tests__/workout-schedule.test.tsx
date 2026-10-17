import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { saveSettings } from '../src/db/settings';
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

// Wednesday 2026-10-07: Push A was done on Monday 10-05, so Tuesday's Pull A was missed.
const WEDNESDAY = () => new Date(2026, 9, 7, 10, 0, 0);
type Db = ReturnType<typeof memoryDb>;
const adj = (db: Db) => JSON.parse(db.rows.get('user_settings:me')!).adjustments;
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
async function open(adjustments: Record<string, unknown> = {}, session = true) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments });
  if (session) {
    const w: Workout = { id: null, version: 0, updated_at: 'x', deleted_at: null, date: '2026-10-05', template: 'Push A', base: 'Push A', where: 'gym', cardio_min: null, mods: {}, exercises: [{ name: 'Machine Chest Press', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], ci_choice: null };
    await saveWorkout(db, w);
    const ex = { name: 'Machine Chest Press', part: 1 as const, bridge: false, form: null, found: null, skipRamp: false, feel: null, sets: [{ ...blankRow(), done: true }], ramp: [] };
    await saveSet(db, '2026-10-05', setRecord(ex, 'work', 0, WEDNESDAY()));
  }
  await render(withProfile(db, <WorkoutScreen db={db} now={WEDNESDAY} />));
  return db;
}

describe('missed day', () => {
  it('offers to shift the week, and Shift the week runs the plan in order', async () => {
    const db = await open();
    expect(await screen.findByText('You missed Pull A on Tuesday')).toBeTruthy();
    expect(screen.getByText('Shift the week forward so nothing gets skipped? Today becomes Pull A, and the rest of the plan follows in order.')).toBeTruthy();
    expect(screen.getByLabelText('Stick to Legs A, missed day')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Shift the week, missed day'));
    await waitFor(() => expect(adj(db)).toMatchObject({ mode: 'sequence', declines: { missed: 0 }, dismissed: { 'missed:2026-10-07': true } }));
    expect(screen.queryByText('You missed Pull A on Tuesday')).toBeNull();
    expect(await screen.findByText('Pull A day')).toBeTruthy();
    expect(screen.getByText('Your plan runs in order, not by weekday.')).toBeTruthy();
  });

  it('"Stick to" counts a decline and hides the card; after 3 declines it offers to stop', async () => {
    const db = await open({ declines: { missed: 3 } });
    await screen.findByText('You missed Pull A on Tuesday');
    await fireEvent.press(screen.getByLabelText('Stop suggesting this, missed day'));
    await waitFor(() => expect(adj(db).muted).toEqual({ missed: true }));
    expect(screen.queryByText('You missed Pull A on Tuesday')).toBeNull();
  });

  it('"Stick to" dismisses with a decline', async () => {
    const db = await open();
    await fireEvent.press(await screen.findByLabelText('Stick to Legs A, missed day'));
    await waitFor(() => expect(adj(db)).toMatchObject({ declines: { missed: 1 }, dismissed: { 'missed:2026-10-07': true } }));
  });

  it('is not shown in sequence mode', async () => {
    await open({ mode: 'sequence' });
    await screen.findByText(/ day$/);
    expect(screen.queryByText(/^You missed/)).toBeNull();
  });

  it('"Go back to fixed weekdays" sets weekday mode', async () => {
    const db = await open({ mode: 'sequence' });
    await fireEvent.press(await screen.findByLabelText('Go back to fixed weekdays'));
    await waitFor(() => expect(adj(db).mode).toBe('weekday'));
    expect(screen.queryByText('Your plan runs in order, not by weekday.')).toBeNull();
  });
});

describe('Fewer days this week?', () => {
  it('opens 3, 4 and 5 days; a choice stores this week as the condensed plan and shows the note', async () => {
    const db = await open({}, false);
    await fireEvent.press(await screen.findByLabelText('Fewer days this week?'));
    expect(screen.getByText('A condensed plan for this week only, then back to normal.')).toBeTruthy();
    expect(screen.getByLabelText('3 days')).toBeTruthy();
    expect(screen.getByLabelText('5 days')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('3 days'));
    await waitFor(() => expect(adj(db).weekPlan).toEqual({ start: '2026-10-05', list: ['Full body A', 'Full body B', 'Full body C'] }));
    expect(await screen.findByText('This week: 3-day plan.')).toBeTruthy();
    expect(screen.getByText('Full body A day')).toBeTruthy();
  });

  it('"Back to the normal week" removes the plan', async () => {
    const db = await open({ weekPlan: { start: '2026-10-05', list: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] } }, false);
    await fireEvent.press(await screen.findByLabelText('Back to the normal week'));
    await waitFor(() => expect(adj(db).weekPlan).toBeUndefined());
    expect(await screen.findByLabelText('Fewer days this week?')).toBeTruthy();
  });
});
