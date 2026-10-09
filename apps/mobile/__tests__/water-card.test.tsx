import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
async function setup(opts: { sizes?: { glass_ml: number; bottle_ml: number }; db?: Db } = {}) {
  const db = opts.db ?? memoryDb();
  await saveProfile(db, profile());
  if (opts.sizes) await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), water_sizes: opts.sizes });
  await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
  await screen.findByText('Water today');
  return db;
}
const waters = (db: Db) => [...db.rows].filter(([k]) => k.startsWith('water_logs:')).map(([, v]) => JSON.parse(v));

describe('Water card', () => {
  it('shows the target from core (33 ml per kg of 82 kg to 100 ml, plus 600 on a training day)', async () => {
    await setup();
    expect(screen.getByLabelText('0 of about 3.3 litres')).toBeTruthy();
    expect(screen.getByLabelText('0% of today’s water')).toBeTruthy();
    expect(screen.queryByLabelText('Undo last water')).toBeNull();
  });

  it('adds a glass and a bottle at once and writes WaterLog rows', async () => {
    const db = await setup();
    await fireEvent.press(screen.getByLabelText('Add a glass, 250 millilitres'));
    await fireEvent.press(screen.getByLabelText('Add a bottle, 1000 millilitres'));
    expect(screen.getByLabelText('1.3 of about 3.3 litres')).toBeTruthy();
    expect(screen.getByLabelText('38% of today’s water')).toBeTruthy();
    await waitFor(() => expect(waters(db).map((w) => w.ml)).toEqual([250, 1000]));
    expect(waters(db)[0]).toMatchObject({ date: '2026-10-08', version: 0, deleted_at: null });
  });

  it('uses the sizes from Settings', async () => {
    await setup({ sizes: { glass_ml: 200, bottle_ml: 750 } });
    await fireEvent.press(screen.getByLabelText('Add a bottle, 750 millilitres'));
    expect(screen.getByLabelText('0.8 of about 3.3 litres')).toBeTruthy();
  });

  it('undo tombstones the last drink instead of deleting it', async () => {
    const db = await setup();
    await fireEvent.press(screen.getByLabelText('Add a glass, 250 millilitres'));
    await fireEvent.press(screen.getByLabelText('Add a bottle, 1000 millilitres'));
    await fireEvent.press(screen.getByLabelText('Undo last water'));
    expect(screen.getByLabelText('0.3 of about 3.3 litres')).toBeTruthy();
    await waitFor(() => expect(waters(db).filter((w) => w.deleted_at).map((w) => w.ml)).toEqual([1000]));
    expect(waters(db)).toHaveLength(2);
  });

  it('keeps a drink after the screen is opened again', async () => {
    const db = await setup();
    await fireEvent.press(screen.getByLabelText('Add a glass, 250 millilitres'));
    await waitFor(() => expect(waters(db)).toHaveLength(1));
    await screen.unmount();
    await setup({ db });
    expect(screen.getByLabelText('0.3 of about 3.3 litres')).toBeTruthy();
  });

  it('saves in the order the user tapped, even when the first write is slow', async () => {
    const db = memoryDb();
    db.lag = (sql) => (sql.includes('water_logs') ? 20 : 0);
    await setup({ db });
    await fireEvent.press(screen.getByLabelText('Add a glass, 250 millilitres'));
    await fireEvent.press(screen.getByLabelText('Undo last water'));
    await waitFor(() => expect(waters(db)[0]?.deleted_at).toBeTruthy());
    expect(waters(db)).toHaveLength(1);
  });

  it('says so when a drink cannot be saved, and still shows it', async () => {
    const db = await setup();
    db.failWrites = true;
    await fireEvent.press(screen.getByLabelText('Add a glass, 250 millilitres'));
    expect(screen.getByLabelText('0.3 of about 3.3 litres')).toBeTruthy();
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeTruthy();
  });

  it('opens the hydration tips', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('Hydration tips'));
    expect(screen.getByText(/plus 600 ml because it’s a training day/)).toBeTruthy();
  });
});
