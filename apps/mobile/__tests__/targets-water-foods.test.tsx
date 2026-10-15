import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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

  it('keeps the stored size when the typed one is out of range or not a number', async () => {
    const db = await setup();
    const bottle = await screen.findByLabelText('Bottle (ml)');
    await fireEvent.changeText(bottle, '49');
    await fireEvent.changeText(bottle, '3001');
    await fireEvent.changeText(bottle, '');
    await fireEvent.changeText(bottle, '3000');
    await waitFor(() => expect(saved(db).water_sizes.bottle_ml).toBe(3000));
    await fireEvent.changeText(bottle, '49');
    expect(saved(db).water_sizes).toEqual({ glass_ml: 250, bottle_ml: 3000 });
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
    expect(JSON.parse(db.rows.get('user_foods:a')!).version).toBe(1);
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
  });
});
