import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { loadSettings, saveSettings } from '../src/db/settings';
import { DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET, DEFAULT_PROTEIN_TARGET } from '@plate-and-bar/core';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { cuisines } from '../src/food/catalog';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';

function profile() {
  return buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}

type Db = ReturnType<typeof memoryDb>;
async function setup(opts: { flex?: number; withProfile?: boolean; db?: Db } = {}) {
  const db = opts.db ?? memoryDb();
  if (opts.withProfile !== false) await saveProfile(db, profile());
  if (opts.flex) await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), flex: [{ id: 'flex-1', date: DATE, kcal_delta: opts.flex }] });
  await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const open = async (meal = 'breakfast') => {
  await fireEvent.press(screen.getByLabelText(`+ Add to ${meal}`));
  await screen.findByLabelText('Search foods');
};

describe('Food screen', () => {
  it('shows the kcal target from core, with flex, and no macro bars without a profile', async () => {
    await setup({ flex: 300 });
    expect(screen.getByLabelText('0 of 2,290 kcal eaten')).toBeTruthy();
    expect(screen.getByText('2,290')).toBeTruthy();
  });

  it('shows the default target and a setup hint without a profile', async () => {
    await setup({ withProfile: false });
    expect(screen.getByLabelText('0 of 1,900 kcal eaten')).toBeTruthy();
    expect(screen.getByLabelText(`Protein 0 of ${DEFAULT_PROTEIN_TARGET} g, ${DEFAULT_PROTEIN_TARGET} g to go`)).toBeTruthy();
    expect(screen.getByLabelText(`Carbs 0 of ${DEFAULT_CARBS_TARGET} g, ${DEFAULT_CARBS_TARGET} g to go`)).toBeTruthy();
    expect(screen.getByLabelText(`Fat 0 of ${DEFAULT_FAT_TARGET} g, ${DEFAULT_FAT_TARGET} g to go`)).toBeTruthy();
  });

  describe('flex chips', () => {
    const flexOf = async (db: Db) => (await loadSettings(db))?.flex ?? [];
    const plan = async (label: string) => {
      await fireEvent.press(screen.getByLabelText('Plan a bigger day'));
      await fireEvent.press(screen.getByLabelText(label));
    };

    it('+300 adds entries sharing one UUID, raises today’s target, saves, and shows core’s toast', async () => {
      const db = await setup();
      await plan('+300 kcal today');
      expect(screen.getByLabelText('0 of 2,290 kcal eaten')).toBeTruthy();
      expect(await screen.findByText(/^Today \+300 kcal; the next 3 days 100 lower/)).toBeTruthy();
      expect(screen.getByText(/includes \+300 kcal for a bigger meal/)).toBeTruthy();
      await waitFor(async () => expect((await flexOf(db)).length).toBe(4));
      const flex = await flexOf(db);
      expect(flex[0]).toMatchObject({ date: DATE, kcal_delta: 300 });
      expect(new Set(flex.map((x) => x.id)).size).toBe(1);
      expect(flex[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(flex.slice(1).map((x) => x.kcal_delta)).toEqual([-100, -100, -100]);
    });

    it('Undo removes every entry of the plan and restores the target', async () => {
      const db = await setup();
      await plan('+500 kcal today');
      await waitFor(async () => expect((await flexOf(db)).length).toBeGreaterThan(1));
      await fireEvent.press(screen.getByLabelText('Undo bigger day'));
      expect(screen.getByLabelText('0 of 1,990 kcal eaten')).toBeTruthy();
      expect(screen.queryByLabelText('Undo bigger day')).toBeNull();
      await waitFor(async () => expect(await flexOf(db)).toEqual([]));
    });

    it('announces whether the chips are open', async () => {
      await setup();
      expect(screen.getByLabelText('Plan a bigger day').props.accessibilityState).toMatchObject({ expanded: false });
      await fireEvent.press(screen.getByLabelText('Plan a bigger day'));
      expect(screen.getByLabelText('Plan a bigger day').props.accessibilityState).toMatchObject({ expanded: true });
    });

    it('PINNED QUIRK (#178): with two plans on today, Undo removes the earlier plan, not the newest', async () => {
      const db = await setup();
      await plan('+300 kcal today');
      const first = (await waitFor(async () => {
        const f = await flexOf(db);
        expect(f.length).toBe(4);
        return f;
      }))[0]!.id;
      await plan('+500 kcal today');
      await waitFor(async () => expect((await flexOf(db)).length).toBeGreaterThan(4));
      await fireEvent.press(screen.getByLabelText('Undo bigger day'));
      await waitFor(async () => {
        const left = await flexOf(db);
        expect(left.length).toBeGreaterThan(0);
        expect(left.some((x) => x.id === first)).toBe(false);
      });
      expect(screen.getByLabelText('0 of 2,490 kcal eaten')).toBeTruthy();
    });

    it('says what could not be spread when the next days have no room', async () => {
      const room = Array.from({ length: 6 }, (_, i) => ({ id: 'old', date: `2026-10-${String(9 + i).padStart(2, '0')}`, kcal_delta: -790 }));
      const db = memoryDb();
      await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), flex: room });
      await setup({ db });
      await plan('+800 kcal today');
      expect(await screen.findByText(/kcal could not be spread without going below your minimum/)).toBeTruthy();
    });

    it('refuses to plan when the saved settings could not be read, and writes nothing', async () => {
      const db = memoryDb();
      const read = db.getFirstAsync.bind(db);
      db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('user_settings')) throw new Error('corrupt');
        return read(sql, ...p);
      }) as typeof db.getFirstAsync;
      await setup({ db });
      await plan('+300 kcal today');
      expect(await screen.findByText(/Couldn’t read your saved settings/)).toBeTruthy();
      expect(screen.getByLabelText('0 of 1,990 kcal eaten')).toBeTruthy();
      await act(async () => {});
      expect(docs(db, 'user_settings')).toHaveLength(0);
    });
  });

  it('logs a food by servings into SQLite at once, with running totals and the fibre row', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText('More servings'));
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    await screen.findByText('Added Roti / chapati ×1.5');
    await fireEvent.press(screen.getByText('Done'));
    expect(screen.getByLabelText('153 of 1,990 kcal eaten')).toBeTruthy();
    expect(screen.getByText(/5 of \d+ g/)).toBeTruthy();
    expect(screen.getByText(/of 5 servings/)).toBeTruthy();
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ date: DATE, meal: 'Breakfast', name: 'Roti / chapati', qty: 1.5, kcal: 102, deleted_at: null });
  });

  it('logs by grams, with the dry-weight hint, and refuses too-small amounts and non-gram servings', async () => {
    const db = await setup();
    await open('lunch');
    expect(screen.getByText(/dry or ingredient weight/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '1');
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    expect(await screen.findByText(/too small to log/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '75');
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    await screen.findByText('Added Roti / chapati (75 g)');
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '50');
    await fireEvent.press(screen.getByLabelText(/^Add Egg, whole/));
    expect(await screen.findByText(/is measured in .*, not grams. Use servings./)).toBeTruthy();
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ meal: 'Lunch', qty: 2.5 });
  });

  it('shows grams typed with a unit without NaN, the source hint, and no badge on eat-out rows', async () => {
    await setup();
    await open();
    expect(screen.getByText(/calculated from USDA public-domain/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '75 g');
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    expect(await screen.findByText('Added Roti / chapati (75 g)')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Eating out'));
    expect(screen.queryByText(/high protein/)).toBeNull();
  });

  it('searches the bundled foods and marks high protein', async () => {
    await setup();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'chawal');
    expect(screen.getByLabelText(/^Add Rice, cooked/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Add Roti \/ chapati/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'whey');
    expect(screen.getByText(/high protein/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'zzzz');
    expect(screen.getByText(/No match/)).toBeTruthy();
  });

  it('adds an eating-out dish and a drink from content', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText('Eating out'));
    expect(screen.getByText('Smart picks')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Drinks'));
    const beer = cuisines.find((c) => c.name === 'Drinks')!.dishes[0]!;
    await fireEvent.press(screen.getByLabelText(new RegExp(`^Add ${beer.name.replace(/[()]/g, '\\$&')}`)));
    await screen.findByText(`Added ${beer.name}`);
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ name: beer.name, qty: 1, kcal: beer.per_serving.kcal, food_id: beer.id });
  });

  it('shows core messages for custom food errors, then logs and saves to my foods', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText('Custom'));
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    expect(await screen.findByText('Give the food a name.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Food'), 'Canteen thali');
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    expect(await screen.findByText('Enter calories or at least one macro.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '-5');
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    expect(await screen.findByText(/can’t be negative/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Food'), 'x'.repeat(201));
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '500');
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    expect(await screen.findByText(/name is too long/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Food'), 'Canteen thali');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '20');
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    await waitFor(() => expect(screen.queryByLabelText('Search foods')).toBeNull());
    expect(screen.getByLabelText('500 of 1,990 kcal eaten')).toBeTruthy();
    await waitFor(() => expect(docs(db, 'user_foods')).toHaveLength(1));
    expect(docs(db, 'user_foods')[0]).toMatchObject({ name: 'Canteen thali', unit: '1 serving', kcal: 500, origin: 'custom', deleted_at: null });
    const food = docs(db, 'user_foods')[0];
    expect(docs(db, 'food_logs')[0]).toMatchObject({ name: 'Canteen thali', food_id: food.id });
    // It now shows in the food list, first.
    await fireEvent.press(screen.getByLabelText('+ Add to breakfast'));
    expect(await screen.findByLabelText(/^Add Canteen thali/)).toBeTruthy();
  });

  it('deletes a log as a tombstone and keeps it out of the totals', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    await screen.findByText(/Added Roti/);
    await fireEvent.press(screen.getByText('Done'));
    await fireEvent.press(screen.getByLabelText('Remove Roti / chapati'));
    expect(screen.getByLabelText('0 of 1,990 kcal eaten')).toBeTruthy();
    await waitFor(() => expect(docs(db, 'food_logs')[0].deleted_at).not.toBeNull());
  });

  it('writes the "logged everything" tick as DayNote.complete and reads it back', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    await screen.findByText(/Added Roti/);
    await fireEvent.press(screen.getByText('Done'));
    await fireEvent.press(screen.getByLabelText('I’ve logged everything I ate today'));
    await waitFor(() => expect(docs(db, 'day_notes')[0]).toMatchObject({ id: null, date: DATE, complete: true, steps: null, sleep: null, fast: false }));
    await screen.unmount();
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    const box = await screen.findByLabelText('I’ve logged everything I ate today');
    expect(box.props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText('102 of 1,990 kcal eaten')).toBeTruthy();
  });

  it('keeps the screen working when a write fails and says so', async () => {
    const db = await setup();
    db.failWrites = true;
    await open();
    await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
    await act(async () => {});
    expect(await screen.findByText('Added Roti / chapati')).toBeTruthy();
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeTruthy();
  });
});
