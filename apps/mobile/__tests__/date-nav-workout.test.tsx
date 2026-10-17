import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const TODAY = '2026-10-08';
const YESTERDAY = '2026-10-07';

const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
async function setup() {
  const db = memoryDb();
  await saveProfile(db, profile());
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  await screen.findByLabelText('Start Push B');
  return db;
}
const back = async () => fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
const forward = async () => fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
const stored = <T,>(db: Db, key: string) => JSON.parse(db.rows.get(key) as string) as T;
const storedSets = (db: Db) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);
/** Starts the first session offered on the day shown; returns its template. */
async function startFirst(): Promise<string> {
  const btn = (await screen.findAllByLabelText(/^Start /))[0]!;
  const label = btn.props.accessibilityLabel as string;
  await fireEvent.press(btn);
  await screen.findByText(label.replace('Start ', ''));
  return label.replace('Start ', '');
}

describe('Workout date navigation', () => {
  it('shows Today, then Yesterday, with next off at today', async () => {
    await setup();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' }).props.accessibilityState).toMatchObject({ disabled: true });
    await back();
    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Wednesday, 7 Oct')).toBeTruthy();
    await forward();
    expect(await screen.findByText('Today')).toBeTruthy();
    expect(screen.getByLabelText('Start Push B')).toBeTruthy();
  });

  it('plans the viewed day, not today', async () => {
    await setup();
    await back();
    await screen.findByText('Yesterday');
    expect(screen.queryByLabelText('Start Push B')).toBeNull(); // Thursday’s session is not offered as the plan for Wednesday
  });

  it('Start, a set tick and the lift stat on a past day write that date, and are there after a reload', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    const template = await startFirst();
    expect(stored<Workout>(db, `workouts:${YESTERDAY}`)).toMatchObject({ date: YESTERDAY, template });
    expect(db.rows.has(`workouts:${TODAY}`)).toBe(false);
    const first = stored<Workout>(db, `workouts:${YESTERDAY}`).exercises[0]!.name;
    const kg = screen.queryByLabelText(`${first} set 1 kg each`);
    if (kg) await fireEvent.changeText(kg, '10');
    await fireEvent.changeText(screen.getByLabelText(`${first} set 1 reps`), '10');
    await fireEvent.press(screen.getByLabelText(`Mark ${first} set 1 done`));
    await waitFor(() => expect(storedSets(db).some((s) => s.done)).toBe(true));
    expect(JSON.parse(db.rows.get(`lift_stats:${first}`) as string).date).toBe(YESTERDAY);

    await screen.unmount();
    await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
    await screen.findByLabelText('Start Push B'); // a reload shows today, still without a session
    await back();
    expect(await screen.findByText(template)).toBeTruthy();
    expect(screen.getByLabelText(`Mark ${first} set 1 done`).props.accessibilityState.checked).toBe(true);
    await forward();
    expect(await screen.findByLabelText('Start Push B')).toBeTruthy();
  });

  it('shows Loading, not the other day’s session, while a day is read', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    await startFirst(); // yesterday has a session; today has none
    const read = db.getFirstAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM workouts')) await gate;
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    await forward();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText(/^Mark .* set 1 done$/)).toBeNull();
    expect(screen.getByText('Today')).toBeTruthy();
    await act(async () => open());
    expect(await screen.findByLabelText('Start Push B')).toBeTruthy();
  });
});
