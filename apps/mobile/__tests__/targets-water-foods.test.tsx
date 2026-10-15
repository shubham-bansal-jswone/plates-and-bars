import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WaterSizesSection } from '../src/targets/WaterAndFoods';
import { pendingWrites } from '../src/db/pendingWrites';
import { SyncContext } from '../src/sync/SyncProvider';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));

const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 9, 8));

const food = (id: string, name: string) => ({ id, version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name, unit: '1 serving', kcal: 120, protein_g: 12.5, carbs_g: 10, fat_g: 3, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' });
const saved = (db: ReturnType<typeof memoryDb>) => JSON.parse(db.rows.get('user_settings:me')!);

async function setup(db = memoryDb()) {
  await saveProfile(db, profile());
  await saveSettings(db, defaultSettings('2026-10-01T00:00:00Z'));
  await render(withProfile(db, <TargetsScreen db={db} />));
  return db;
}

describe('Targets: Water sizes and My foods', () => {
  it('shows the default glass and bottle sizes and saves an edit in range', async () => {
    const db = await setup();
    const glass = await screen.findByLabelText('Glass (ml)');
    expect(glass.props.value).toBe('250');
    expect(screen.getByLabelText('Bottle (ml)').props.value).toBe('1000');
    await fireEvent.changeText(glass, '330');
    await waitFor(() => expect(saved(db).water_sizes).toEqual({ glass_ml: 330, bottle_ml: 1000 }));
  });

  it('keeps the stored size when the typed one is out of range or not a number, and rounds the rest', async () => {
    const db = await setup();
    const bottle = await screen.findByLabelText('Bottle (ml)');
    for (const bad of ['49', '3001', '', 'abc']) {
      await fireEvent.changeText(bottle, bad);
      expect(saved(db).water_sizes.bottle_ml).toBe(1000);
    }
    await fireEvent.changeText(bottle, '50');
    await waitFor(() => expect(saved(db).water_sizes.bottle_ml).toBe(50));
    await fireEvent.changeText(bottle, '3000');
    await waitFor(() => expect(saved(db).water_sizes.bottle_ml).toBe(3000));
    await fireEvent.changeText(bottle, '3001');
    expect(saved(db).water_sizes.bottle_ml).toBe(3000);
    await fireEvent.changeText(bottle, '330.4');
    await waitFor(() => expect(saved(db).water_sizes.bottle_ml).toBe(330));
  });

  it('an edit keeps the other stored size', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), water_sizes: { glass_ml: 300, bottle_ml: 500 } });
    await render(withProfile(db, <TargetsScreen db={db} />));
    await fireEvent.changeText(await screen.findByLabelText('Glass (ml)'), '330');
    await waitFor(() => expect(saved(db).water_sizes).toEqual({ glass_ml: 330, bottle_ml: 500 }));
  });

  it('shows a size that changed in the stored settings, but leaves a box whose text already reads as it', async () => {
    const ui = (g: number, b: number) => <WaterSizesSection sizes={{ glass_ml: g, bottle_ml: b }} onChange={() => {}} />;
    const { rerender } = await render(ui(250, 1000));
    await fireEvent.changeText(screen.getByLabelText('Glass (ml)'), '330.4');
    await rerender(ui(330, 1000));
    expect(screen.getByLabelText('Glass (ml)').props.value).toBe('330.4');
    await rerender(ui(400, 1500));
    expect(screen.getByLabelText('Glass (ml)').props.value).toBe('400');
    expect(screen.getByLabelText('Bottle (ml)').props.value).toBe('1500');
  });

  it('with no saved foods shows the hint', async () => {
    await setup();
    expect(await screen.findByText(/Foods you add under Custom with “Save to my foods”/)).toBeTruthy();
  });

  it('lists my foods and deletes one by writing a tombstone', async () => {
    const db = memoryDb();
    db.rows.set('user_foods:a', JSON.stringify(food('a', 'Paneer bhurji')));
    db.rows.set('user_foods:b', JSON.stringify(food('b', 'Dal')));
    await setup(db);
    expect(await screen.findByText('Paneer bhurji')).toBeTruthy();
    expect(screen.getAllByText('120 kcal, 12.5 g protein')).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('Delete Paneer bhurji'));
    expect(screen.queryByText('Paneer bhurji')).toBeNull();
    expect(screen.getByText('Dal')).toBeTruthy();
    await waitFor(() => expect(JSON.parse(db.rows.get('user_foods:a')!).deleted_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/));
    const tomb = JSON.parse(db.rows.get('user_foods:a')!);
    expect(tomb.version).toBe(1);
    expect(tomb.updated_at).toBe(tomb.deleted_at);
    expect(tomb.updated_at > '2026-10-01T00:00:00Z').toBe(true);
    expect(JSON.parse(db.rows.get('user_foods:b')!).deleted_at).toBeNull();
  });

  it('puts Water sizes, Kitchen tests and My foods in the prototype order', async () => {
    await setup();
    await screen.findByLabelText('Glass (ml)');
    const order = ['Workout', 'Water sizes', 'Kitchen tests', 'My foods'];
    const json = JSON.stringify(screen.toJSON());
    const at = order.map((t) => json.indexOf(`"${t}"`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('a food whose delete cannot be written shows a message', async () => {
    const db = memoryDb();
    db.rows.set('user_foods:a', JSON.stringify(food('a', 'Dal')));
    await setup(db);
    await screen.findByText('Dal');
    db.failWrites = true;
    await fireEvent.press(screen.getByLabelText('Delete Dal'));
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeTruthy();
    expect(await screen.findByText('Dal')).toBeTruthy();
  });

  const withSync = (db: ReturnType<typeof memoryDb>, n: number) => withProfile(db, <SyncContext.Provider value={{ dataVersion: n } as never}><TargetsScreen db={db} /></SyncContext.Provider>);

  it('reads my foods again after a sync pulled records', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const { rerender } = await render(withSync(db, 0));
    await screen.findByText(/Foods you add under Custom/);
    db.rows.set('user_foods:n', JSON.stringify(food('n', 'Pulled food')));
    await rerender(withSync(db, 1));
    expect(await screen.findByText('Pulled food')).toBeTruthy();
  });

  it('a re-read waits for a delete still being written, and the delete is registered as a pending write', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    db.rows.set('user_foods:a', JSON.stringify(food('a', 'Dal')));
    const { rerender } = await render(withSync(db, 0));
    await screen.findByText('Dal');
    db.lag = (sql) => (sql.includes('user_foods') ? 150 : 0);
    await fireEvent.press(screen.getByLabelText('Delete Dal'));
    await rerender(withSync(db, 1));
    expect(JSON.parse(db.rows.get('user_foods:a')!).deleted_at).toBeNull();
    await act(async () => {
      await pendingWrites();
    });
    expect(JSON.parse(db.rows.get('user_foods:a')!).deleted_at).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText('Dal')).toBeNull();
  });
});
