import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { kitchenTest } from '@plate-and-bar/core';
import { KitchenTestScreen } from '../src/screens/KitchenTestScreen';
import { fmt } from '../src/format';
import { rawIngredients } from '../src/recipes/content';
import { loadKitchenTests } from '../src/db/kitchenTests';
import { loadUserFoods } from '../src/db/food';
import { pendingWrites } from '../src/db/pendingWrites';
import { memoryDb } from './helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
type Db = ReturnType<typeof memoryDb>;
const stored = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v) as Record<string, unknown>);

async function setup(db: Db = memoryDb(), onBack = jest.fn()) {
  await render(<KitchenTestScreen db={db} onBack={onBack} now={NOW} />);
  await screen.findByRole('header', { name: 'Kitchen tests' });
  return { db, onBack };
}
const start = async () => {
  await fireEvent.press(screen.getByLabelText('New kitchen test'));
  await screen.findByRole('header', { name: 'Kitchen test' });
};
// Dal 150 g dry + ghee 15 g, pot 500 g empty, 1,500 g full, a 250 g serving.
const fill = async (serving = '250') => {
  await fireEvent.changeText(screen.getByLabelText('Dish'), '  Dal  ');
  await fireEvent.changeText(screen.getByLabelText('Amount for ingredient 1'), '150');
  await fireEvent.changeText(screen.getByLabelText('Empty pot (g)'), '500');
  await fireEvent.changeText(screen.getByLabelText('Pot with food (g)'), '1500');
  if (serving) await fireEvent.changeText(screen.getByLabelText('One serving (g)'), serving);
};
const rows = [{ ingredient: 'Toor dal (dry)', amount: 150, unit: 'g' }];
const core = (serving: number | null) => kitchenTest({ ingredients: rows, pot_g: 500, pot_full_g: 1500, cooked_g: null, serving_g: serving }, rawIngredients);

describe('Kitchen test screen', () => {
  it('shows the cooked weight, per 100 g and per serving that core computes from the pot weights', async () => {
    await setup();
    await start();
    expect(screen.getByText('Add the cooked weight (or the pot weights) to see the results.')).toBeTruthy();
    await fill();
    const r = core(250);
    if (!r.ready || !r.perServing) throw new Error('core not ready');
    expect(screen.getByText(new RegExp(`^Cooked weight: 1,000 g, about 4 servings\\. Per 100 g: ${fmt(r.per100g.kcal)} kcal`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Per katori \\(250 g\\): ${fmt(r.perServing.kcal)} kcal`))).toBeTruthy();
  });

  it('an empty pot of 0 g counts (a tared scale)', async () => {
    await setup();
    await start();
    await fireEvent.changeText(screen.getByLabelText('Amount for ingredient 1'), '150');
    await fireEvent.changeText(screen.getByLabelText('Empty pot (g)'), '0');
    await fireEvent.changeText(screen.getByLabelText('Pot with food (g)'), '900');
    expect(screen.getByText(/^Cooked weight: 900 g/)).toBeTruthy();
  });

  it('Save test stores the test with no food', async () => {
    const db = memoryDb();
    await setup(db);
    await start();
    await fill('');
    await fireEvent.press(screen.getByLabelText('Save test'));
    expect(await screen.findByText('Kitchen test saved')).toBeTruthy();
    const [t] = await waitFor(async () => {
      const x = await loadKitchenTests(db);
      expect(x).toHaveLength(1);
      return x;
    });
    expect(t).toMatchObject({ name: 'Dal', date: '2026-10-08', pot_g: 500, pot_full_g: 1500, cooked_g: null, serving_g: null, serving_name: 'katori', has_photo: false, ingredients: rows });
    expect(await loadUserFoods(db)).toHaveLength(0);
    // The list shows it with the date.
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(screen.getByText('8 Oct')).toBeTruthy();
  });

  it('Save and use for my logging saves the food per serving, merged with a food saved elsewhere meanwhile', async () => {
    const db = memoryDb();
    await setup(db);
    await start();
    db.rows.set('user_foods:f-other', JSON.stringify({ id: 'f-other', version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Other', unit: '1', kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom' }));
    await fill();
    await fireEvent.press(screen.getByLabelText('Save and use for my logging'));
    expect(await screen.findByText('Saved. Dal now logs with your weighed values.')).toBeTruthy();
    const r = core(250);
    const mine = await waitFor(async () => {
      const m = await loadUserFoods(db);
      expect(m).toHaveLength(2);
      return m;
    });
    const food = mine.find((f) => f.name === 'Dal')!;
    expect(food).toMatchObject({ unit: '1 katori (250 g)', kcal: r.ready && r.perServing ? Math.round(r.perServing.kcal) : -1, origin: 'kitchen_test', added_sugar_g: 0, fruit_veg_servings: null });
    expect(mine.some((f) => f.name === 'Other')).toBe(true);
  });

  it('merges with my foods as stored at save time: the 80 cap tombstones the oldest, a same-name food keeps its id', async () => {
    const db = memoryDb();
    await setup(db);
    await start();
    const food = (name: string, extra: Record<string, unknown>) => ({ id: name, version: 1, updated_at: '2026-09-10T00:00:00Z', deleted_at: null, name, unit: '1', kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null, origin: 'custom', ...extra });
    // Seeded after the screen loaded, so only a re-read at write time sees them.
    for (let i = 0; i < 80; i++) db.rows.set(`user_foods:f${i}`, JSON.stringify(food(`Food ${i}`, { id: `f${i}`, updated_at: `2026-09-${String(10 + Math.floor(i / 10)).padStart(2, '0')}T0${i % 10}:00:00Z` })));
    db.rows.set('user_foods:same', JSON.stringify(food('Dal', { id: 'same', version: 4 })));
    await fill();
    await fireEvent.press(screen.getByLabelText('Save and use for my logging'));
    await waitFor(async () => expect((await loadUserFoods(db)).some((f) => f.origin === 'kitchen_test')).toBe(true));
    const all = stored(db, 'user_foods');
    expect(all.filter((f) => f.name === 'Dal')).toEqual([expect.objectContaining({ id: 'same', version: 4, origin: 'kitchen_test' })]);
    expect(await loadUserFoods(db)).toHaveLength(80);
    expect(all.filter((f) => f.deleted_at).map((f) => f.name)).toEqual(['Food 0']);
  });

  it('registers its writes so Food waits for them, and Back waits once, even when pressed twice', async () => {
    const db = memoryDb();
    db.lag = () => 40;
    const { onBack } = await setup(db);
    await start();
    await fill();
    await fireEvent.press(screen.getByLabelText('Save and use for my logging'));
    let landed = false;
    void pendingWrites().then(() => (landed = stored(db, 'kitchen_tests').length === 1 && stored(db, 'user_foods').length === 1));
    await fireEvent.press(screen.getByLabelText('Back'));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).not.toHaveBeenCalled();
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    expect(landed).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('lists the last saved test first', async () => {
    const db = memoryDb();
    let minute = 0;
    await render(<KitchenTestScreen db={db} onBack={jest.fn()} now={() => new Date(2026, 9, 8, 10, minute++, 0)} />);
    await screen.findByRole('header', { name: 'Kitchen tests' });
    for (const name of ['Dal', 'Rice']) {
      await start();
      await fireEvent.changeText(screen.getByLabelText('Dish'), name);
      await fireEvent.changeText(screen.getByLabelText('Amount for ingredient 1'), '100');
      await fireEvent.changeText(screen.getByLabelText('Or cooked weight directly (g)'), '300');
      await fireEvent.press(screen.getByLabelText('Save test'));
      await waitFor(async () => expect((await loadKitchenTests(db)).map((t) => t.name)).toContain(name));
    }
    await waitFor(() => expect(screen.getAllByLabelText(/^Delete /).map((n) => n.props.accessibilityLabel)).toEqual(['Delete Rice', 'Delete Dal']));
  });

  it('shows an error with Back when the saved tests cannot be read', async () => {
    const db = memoryDb();
    db.getAllAsync = () => Promise.reject(new Error('disk'));
    const onBack = jest.fn();
    await render(<KitchenTestScreen db={db} onBack={onBack} now={NOW} />);
    expect(await screen.findByText('Couldn’t read your saved kitchen tests.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it('Save and use without a serving saves the test, says to weigh one, and keeps the form', async () => {
    const db = memoryDb();
    await setup(db);
    await start();
    await fill('');
    await fireEvent.press(screen.getByLabelText('Save and use for my logging'));
    expect(await screen.findByText('Weigh one serving first, so the app knows the portion.')).toBeTruthy();
    await waitFor(() => expect(stored(db, 'kitchen_tests')).toHaveLength(1));
    expect(await loadUserFoods(db)).toHaveLength(0);
    // Adding the serving and saving again updates the same test.
    await fireEvent.changeText(screen.getByLabelText('One serving (g)'), '250');
    await fireEvent.press(screen.getByLabelText('Save and use for my logging'));
    await waitFor(async () => expect(await loadUserFoods(db)).toHaveLength(1));
    expect(stored(db, 'kitchen_tests')).toHaveLength(1);
  });

  it('says what is missing instead of saving', async () => {
    const db = memoryDb();
    await setup(db);
    await start();
    await fireEvent.press(screen.getByLabelText('Save test'));
    expect(await screen.findByText('Name the dish.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Dish'), 'Dal');
    await fireEvent.press(screen.getByLabelText('Save test'));
    expect(await screen.findByText('Add the raw ingredients with their weights.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount for ingredient 1'), '150');
    await fireEvent.press(screen.getByLabelText('Save test'));
    expect(await screen.findByText('Add the cooked weight, or both pot weights.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Date'), '2026-13-40');
    expect(screen.getByText('Use a date like 2026-10-08.')).toBeTruthy();
    expect(stored(db, 'kitchen_tests')).toHaveLength(0);
  });

  it('deleting a test is a tombstone and leaves the food it made', async () => {
    const db = memoryDb();
    await setup(db);
    await start();
    await fill();
    await fireEvent.press(screen.getByLabelText('Save and use for my logging'));
    await screen.findByLabelText('Delete Dal');
    await fireEvent.press(screen.getByLabelText('Delete Dal'));
    expect(await screen.findByText('Test deleted')).toBeTruthy();
    await waitFor(() => expect(stored(db, 'kitchen_tests')[0]!.deleted_at).toEqual(expect.any(String)));
    expect(stored(db, 'kitchen_tests')).toHaveLength(1);
    expect(await loadUserFoods(db)).toHaveLength(1);
    expect(screen.queryByLabelText('Delete Dal')).toBeNull();
  });

  it('skips stored tests of the wrong shape', async () => {
    const db = memoryDb();
    const ok = { id: 'k1', version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Roti', date: '2026-10-01', note: 'Mom’s', ingredients: [{ ingredient: 'Kuttu atta', amount: 100, unit: 'g' }], pot_g: null, pot_full_g: null, cooked_g: 150, serving_g: 50, serving_name: 'piece', has_photo: false };
    db.rows.set('kitchen_tests:k1', JSON.stringify(ok));
    db.rows.set('kitchen_tests:k2', JSON.stringify({ ...ok, id: 'k2', name: 'Bad', serving_name: 'bucket' }));
    db.rows.set('kitchen_tests:k3', JSON.stringify({ ...ok, id: 'k3', name: 'Gone', deleted_at: '2026-10-02T00:00:00Z' }));
    await setup(db);
    expect(screen.getByText('Roti')).toBeTruthy();
    expect(screen.getByText(/1 Oct, \d+ kcal per piece \(50 g\), Mom’s/)).toBeTruthy();
    expect(screen.queryByText('Bad')).toBeNull();
    expect(screen.queryByText('Gone')).toBeNull();
  });
});
