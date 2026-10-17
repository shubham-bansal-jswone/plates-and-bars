import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const draft = (o: Record<string, unknown>) =>
  buildProfile({ ...emptyDraft(), sex: 'female', age: '30', unit: 'cm', cm: '165', weight: '70', activity: 'sitting', where: 'gym', days: 4, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'], ...o } as never, new Date(2026, 8, 1));
async function open(o: Record<string, unknown>) {
  const db = memoryDb();
  await saveProfile(db, draft(o));
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  return db;
}

describe('clearance card on Workout start (#692)', () => {
  it('shows for a health-check yes, and "My doctor has cleared me" saves cleared and removes it', async () => {
    const db = await open({ screen: ['yes', 'no', 'no', 'no', 'no', 'no'] });
    expect(await screen.findByText('Check with your doctor first')).toBeTruthy();
    expect(screen.getByText(/Your health check suggests getting a doctor’s OK before starting a new training plan\. Until then, sessions stay light with no weight increases\./)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('My doctor has cleared me'));
    await waitFor(() => expect(screen.queryByText('Check with your doctor first')).toBeNull());
    expect(JSON.parse(db.rows.get('profiles:me')!).cleared).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText('Thanks. Your normal plan is back.')).toBeTruthy();
  });

  it('shows the pregnancy wording', async () => {
    await open({ special: 'pregnant' });
    expect(await screen.findByText(/During pregnancy, follow your doctor’s or midwife’s advice on exercise\./)).toBeTruthy();
  });

  it('is not shown when no clearance is needed or it was given', async () => {
    await open({});
    await screen.findByText(/ day$/);
    expect(screen.queryByText('Check with your doctor first')).toBeNull();
  });

  it('sits above the day title as a level 2 heading', async () => {
    await open({ screen: ['yes', 'no', 'no', 'no', 'no', 'no'] });
    await screen.findByText('Check with your doctor first');
    const heads = screen.getAllByRole('header');
    expect(heads[0]!.props['aria-level']).toBe(2);
    expect(heads[1]!.props['aria-level']).toBe(1);
  });
});
