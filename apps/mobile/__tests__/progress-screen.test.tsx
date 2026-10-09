import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { saveWeight } from '../src/db/progress';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';

function profile(sex: 'male' | 'female' = 'male') {
  return buildProfile(
    { ...emptyDraft(), sex, age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}

type Db = ReturnType<typeof memoryDb>;
async function setup(opts: { sex?: 'male' | 'female'; db?: Db } = {}) {
  const db = opts.db ?? memoryDb();
  await saveProfile(db, profile(opts.sex));
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const weigh = (date: string, kg: number) => ({ id: null, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, weight_kg: kg });

describe('Progress screen', () => {
  it('saves a weigh-in to SQLite, rounded to 0.1, and shows it as the latest', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81.64');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('Latest: 81.6 kg')).toBeTruthy();
    await waitFor(() => expect(docs(db, 'weights')).toEqual([expect.objectContaining({ date: DATE, weight_kg: 81.6, deleted_at: null })]));
  });

  it('rejects a weight outside the contract range and writes nothing', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '12');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    expect(await screen.findByText('Enter your weight in kg, like 81.6')).toBeTruthy();
    expect(docs(db, 'weights')).toEqual([]);
  });

  it('clearing the box tombstones the weigh-in instead of deleting it', async () => {
    const db = memoryDb();
    await saveWeight(db, weigh(DATE, 80));
    await setup({ db });
    expect(screen.getByDisplayValue('80')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => expect(docs(db, 'weights')[0].deleted_at).not.toBeNull());
    expect(docs(db, 'weights')[0].weight_kg).toBe(80);
    expect(screen.queryByText('Latest: 80 kg')).toBeNull();
  });

  it('keeps writes in the order the user acted when the first is slow', async () => {
    const db = memoryDb();
    db.lag = (sql) => (sql.includes('weights') ? 30 : 0);
    await setup({ db });
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '80.5');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => expect(docs(db, 'weights')[0].weight_kg).toBe(80.5));
  });

  it('shows the navy body-fat estimate from core once waist and neck are saved', async () => {
    const db = await setup();
    expect(screen.getByText('Add waist and neck for a body-fat estimate.')).toBeTruthy();
    expect(screen.queryByLabelText('Hips in cm')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Waist (at navel) in cm'), '90');
    await fireEvent.changeText(screen.getByLabelText('Neck in cm'), '38');
    await fireEvent.press(screen.getByLabelText('Save for today'));
    expect(await screen.findByText(/Estimated body fat: about \d+%/)).toBeTruthy();
    await waitFor(() => expect(docs(db, 'measurements')).toEqual([expect.objectContaining({ date: DATE, waist_cm: 90, neck_cm: 38, chest_cm: null })]));
  });

  it('asks for at least one valid measurement', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Waist (at navel) in cm'), '5');
    await fireEvent.press(screen.getByLabelText('Save for today'));
    expect(await screen.findByText('Enter at least one measurement in cm.')).toBeTruthy();
    expect(docs(db, 'measurements')).toEqual([]);
  });

  it('shows hips for women, and body fat needs hips for them', async () => {
    await setup({ sex: 'female' });
    expect(screen.getByLabelText('Hips in cm')).toBeTruthy();
    expect(screen.getByText('Add waist and neck and hips for a body-fat estimate.')).toBeTruthy();
  });

  it('saves steps and sleep on the day note and keeps its other fields', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '8200');
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '7.5');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ date: DATE, steps: 8200, sleep: 7.5, fast: false, complete: null })]));
    expect(screen.getByText('steps today, target about 7,000')).toBeTruthy();
  });

  it('rejects more than 24 hours of sleep', async () => {
    const db = await setup();
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '30');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    expect(await screen.findByText('Enter hours slept, like 7.5.')).toBeTruthy();
    expect(docs(db, 'day_notes')).toEqual([]);
  });

  it('tells the user when the read fails', async () => {
    const db = memoryDb();
    db.getAllAsync = async () => {
      throw new Error('locked');
    };
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByText('Couldn’t read your saved progress.')).toBeTruthy();
    await act(async () => {});
  });
});

describe('Targets: recalculate after weigh-in drift (#161)', () => {
  const targets = async (db: Db) => {
    await render(withProfile(db, <TargetsScreen db={db} now={NOW} />));
    await screen.findByLabelText('Redo setup');
  };

  it('offers Recalculate when the latest weigh-in is 2 kg or more from the setup weight', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWeight(db, weigh('2026-10-01', 79.4));
    await targets(db);
    expect(await screen.findByText('Your latest weight is 79.4 kg, 2.6 kg lower than at setup. Recalculate your targets?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Recalculate targets'));
    expect(mockPush).toHaveBeenCalledWith('/setup?recalc=1');
  });

  it('does not offer it for a small change, nor for a deleted weigh-in', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWeight(db, weigh('2026-10-01', 81));
    await saveWeight(db, { ...weigh('2026-10-02', 70), deleted_at: '2026-10-02T01:00:00Z' });
    await targets(db);
    await act(async () => {});
    expect(screen.queryByLabelText('Recalculate targets')).toBeNull();
  });
});
