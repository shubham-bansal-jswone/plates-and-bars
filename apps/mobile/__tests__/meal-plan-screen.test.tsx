import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { buildPlan, groceryList, type MealPlan } from '@plate-and-bar/core';
import { setPlanDraft } from '../src/meals/planDraft';
import { MealPlanScreen } from '../src/screens/MealPlanScreen';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { loadSettings, saveSettings } from '../src/db/settings';
import { getFoodCatalog } from '../src/food/catalog';
import { mealGrocery, mealPlanning } from '../src/meals/content';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
type Db = ReturnType<typeof memoryDb>;
const expected = (diet: 'any' | 'egg' | 'veg' = 'any'): MealPlan => {
  const t = profile().targets;
  return buildPlan({ kcal: t.kcal, protein: t.protein_g, fat: t.fat_g, age: 30 }, DATE, { foods: getFoodCatalog(), planning: mealPlanning, diet });
};
async function setup(onBack = jest.fn(), db: Db = memoryDb()) {
  await saveProfile(db, profile());
  await render(withProfile(db, <MealPlanScreen db={db} onBack={onBack} now={NOW} />));
  await screen.findByRole('header', { name: 'Your week of meals' });
  return { db, onBack };
}

describe('Meal plan screen', () => {
  beforeEach(() => {
    setPlanDraft(null);
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  });

  it('shows seven days built by core, with each day’s totals', async () => {
    await setup();
    expect(screen.getAllByText(/^About [\d,]+ kcal, \d+ g protein$/)).toHaveLength(7);
    expect(screen.getByRole('header', { name: 'Thursday, 8 Oct' })).toBeTruthy();
    const first = expected().opts.Breakfast![0]![0]![0];
    expect(screen.getAllByText(new RegExp(first)).length).toBeGreaterThan(0);
  });

  it('Swap moves a meal to its next idea and Use this plan saves it to settings', async () => {
    const { db, onBack } = await setup();
    await fireEvent.press(screen.getByLabelText('Swap Lunch on Thursday, 8 Oct'));
    await fireEvent.press(screen.getByLabelText('Use this plan'));
    // The screen stays open so the message is seen; Back is the user's.
    expect(await screen.findByText(/Meal plan saved/)).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
    const saved = await waitFor(async () => {
      const s = (await loadSettings(db))?.meal_plan;
      expect(s).not.toBeNull();
      return s as MealPlan;
    });
    expect(saved.start).toBe(DATE);
    expect(saved.days[0]!.Lunch!.k).toBe(1);
    expect(saved.days[0]!.Breakfast!.k).toBe(0);
  });

  it('reopens the saved plan while it is current, and Start over builds a new one', async () => {
    const db = memoryDb();
    const own: MealPlan = { start: '2026-10-05', opts: { Breakfast: [[['Idli', 3]]] }, days: [{ Breakfast: { k: 0 } }] };
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), meal_plan: own });
    await setup(jest.fn(), db);
    expect(screen.getByText(/Idli ×3/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Start over'));
    expect(screen.queryByText(/Idli ×3/)).toBeNull();
    expect(screen.getByRole('header', { name: 'Thursday, 8 Oct' })).toBeTruthy();
  });

  it('refuses to save after a failed settings load', async () => {
    const db = memoryDb();
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) throw new Error('corrupt');
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    const { onBack } = await setup(jest.fn(), db);
    await fireEvent.press(screen.getByLabelText('Use this plan'));
    expect(await screen.findByText(/Couldn’t read your saved settings/)).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
    expect([...db.rows.keys()].some((k) => k.startsWith('user_settings:'))).toBe(false);
  });

  it('keeps an unsaved draft when the screen is closed and opened again', async () => {
    const { db } = await setup();
    await fireEvent.press(screen.getByLabelText('Swap Lunch on Thursday, 8 Oct'));
    await screen.unmount();
    await render(withProfile(db, <MealPlanScreen db={db} onBack={jest.fn()} now={NOW} />));
    await screen.findByRole('header', { name: 'Your week of meals' });
    await fireEvent.press(screen.getByLabelText('Use this plan'));
    const saved = await waitFor(async () => {
      const s = (await loadSettings(db))?.meal_plan;
      expect(s).not.toBeNull();
      return s as MealPlan;
    });
    expect(saved.days[0]!.Lunch!.k).toBe(1);
  });

  it('waits for the stored settings before showing the plan, so Use this plan keeps them', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const own: MealPlan = { start: '2026-10-05', opts: { Breakfast: [[['Idli', 3]]] }, days: [{ Breakfast: { k: 0 } }] };
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), focus: ['Chest'], meal_plan: own });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const read = db.getFirstAsync.bind(db);
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) await gate;
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    await render(withProfile(db, <MealPlanScreen db={db} onBack={jest.fn()} now={NOW} />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByLabelText('Use this plan')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await act(async () => release());
    await screen.findByRole('header', { name: 'Your week of meals' });
    expect(screen.getByText(/Idli ×3/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Use this plan'));
    await waitFor(async () => expect((await loadSettings(db))?.meal_plan?.start).toBe('2026-10-05'));
    expect((await loadSettings(db))?.focus).toEqual(['Chest']);
  });

  it('says so when the clipboard refuses the copy', async () => {
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(false);
    await setup();
    await fireEvent.press(screen.getByLabelText('Grocery list'));
    await fireEvent.press(screen.getByLabelText('Copy as text'));
    expect(await screen.findByText('Couldn’t copy on this device')).toBeTruthy();
    expect(screen.queryByText('Grocery list copied')).toBeNull();
  });

  it('plans with my own food first when it shares a name', async () => {
    const db = memoryDb();
    const own: MealPlan = { start: DATE, opts: { Breakfast: [[['Idli', 1]]] }, days: [{ Breakfast: { k: 0 } }] };
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), meal_plan: own });
    db.rows.set('user_foods:u1', JSON.stringify({ id: 'u1', version: 0, updated_at: '2026-10-08T00:00:00Z', deleted_at: null, name: 'Idli', unit: '1 piece', kcal: 777, protein_g: 5, carbs_g: 10, fat_g: 1, fibre_g: null, added_sugar_g: null, fruit_veg_servings: null }));
    await setup(jest.fn(), db);
    expect(screen.getAllByText('About 777 kcal, 5 g protein').length).toBeGreaterThan(0);
  });

  it('the grocery list shows core’s rows, ticks items and copies the text', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('Grocery list'));
    const list = groceryList(expected(), mealGrocery);
    const r = list.rows[0]!;
    const row = screen.getByLabelText(`${r.item}, ${r.label}`);
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(row);
    expect(screen.getByLabelText(`${r.item}, ${r.label}`).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('Copy as text'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(list.text);
    expect(await screen.findByText('Grocery list copied')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back to the plan'));
    expect(screen.getByRole('header', { name: 'Your week of meals' })).toBeTruthy();
  });
});

describe('Food tab with a saved plan', () => {
  it('offers the planned meal and logs it', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const plan: MealPlan = { start: DATE, opts: { Breakfast: [[['Idli', 3], ['Egg, whole', 2]]] }, days: [{ Breakfast: { k: 0 } }] };
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), meal_plan: plan });
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    expect(await screen.findByText('From your plan: Idli ×3 + Egg, whole ×2')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Log your planned breakfast'));
    expect(await screen.findByText('Logged your planned breakfast')).toBeTruthy();
    expect(screen.queryByText(/^From your plan/)).toBeNull();
    await waitFor(() => expect([...db.rows.keys()].filter((k) => k.startsWith('food_logs:'))).toHaveLength(2));
  });
});

describe('A malformed saved plan', () => {
  it('reads as none, so Food and the plan screen do not crash', async () => {
    const db = memoryDb();
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), meal_plan: {} as unknown as MealPlan });
    expect((await loadSettings(db))?.meal_plan).toBeNull();
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), meal_plan: { start: DATE, opts: { Lunch: [['x']] }, days: [] } as unknown as MealPlan });
    expect((await loadSettings(db))?.meal_plan).toBeNull();
    await saveProfile(db, profile());
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    expect(await screen.findByRole('header', { name: 'Food' })).toBeTruthy();
  });
});
