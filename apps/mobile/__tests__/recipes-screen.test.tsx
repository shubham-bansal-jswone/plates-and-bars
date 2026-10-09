import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { presetIngredients, recipeTotals } from '@plate-and-bar/core';
import { RecipesScreen } from '../src/screens/RecipesScreen';
import { fmt } from '../src/format';
import { katoriG, library, presets, rawIngredients } from '../src/recipes/content';
import { stepMinutes } from '../src/recipes/CookMode';
import { loadRecipes } from '../src/db/recipes';
import { loadUserFoods } from '../src/db/food';
import { memoryDb } from './helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
type Db = ReturnType<typeof memoryDb>;
const stored = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v) as Record<string, unknown>);

async function setup(db: Db = memoryDb(), onBack = jest.fn()) {
  await render(<RecipesScreen db={db} onBack={onBack} now={NOW} />);
  await screen.findByRole('header', { name: 'Recipes' });
  return { db, onBack };
}
const food = (name: string, extra: Record<string, unknown> = {}) => ({ id: `f-${name}`, version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name, unit: '1 katori', kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, fibre_g: 0, added_sugar_g: 0, fruit_veg_servings: null, origin: 'custom', ...extra });

describe('Recipes screen: builder', () => {
  it('shows the whole pot and per-katori values core computes for a starting point at an oil level', async () => {
    await setup();
    const dal = presets.find((p) => p.name === 'Dal')!;
    await fireEvent.press(screen.getByLabelText('Dal'));
    const t = recipeTotals({ ingredients: presetIngredients(dal.ingredients, 'normal', rawIngredients), yield_mode: 'katori', katoris: dal.katoris, cooked_g: null }, rawIngredients, katoriG);
    expect(screen.getByText(new RegExp(`^Whole pot: ${fmt(t.total.kcal)} kcal`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Per katori \\(about 150 g cooked\\): ${fmt(t.perKatori!.kcal)} kcal`))).toBeTruthy();
    expect(screen.getByDisplayValue('Dal (home-style)')).toBeTruthy();
    // A richer oil level changes the fatty rows and the numbers.
    await fireEvent.press(screen.getByLabelText('Rich'));
    const rich = recipeTotals({ ingredients: presetIngredients(dal.ingredients, 'rich', rawIngredients), yield_mode: 'katori', katoris: dal.katoris, cooked_g: null }, rawIngredients, katoriG);
    expect(rich.total.kcal).toBeGreaterThan(t.total.kcal);
    expect(screen.getByText(new RegExp(`^Whole pot: ${fmt(rich.total.kcal)} kcal`))).toBeTruthy();
    expect(screen.getByDisplayValue('Dal (home-style)')).toBeTruthy();
  });

  it('weighed-pot yield turns grams into katoris', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('Dal'));
    await fireEvent.press(screen.getByLabelText('I weighed the pot'));
    await fireEvent.changeText(screen.getByLabelText('Cooked weight in grams'), '750');
    expect(screen.getByText('Makes about 5 katoris.')).toBeTruthy();
  });

  it('Save and add stores the recipe, my food and the log, goes back to Food, and keeps a food saved elsewhere meanwhile', async () => {
    const db = memoryDb();
    const { onBack } = await setup(db);
    db.rows.set('user_foods:f-Other', JSON.stringify(food('Other')));
    await fireEvent.press(screen.getByLabelText('Dal'));
    await fireEvent.press(screen.getByLabelText('More katoris'));
    await fireEvent.press(screen.getByLabelText('Dinner'));
    await fireEvent.press(screen.getByLabelText('Save and add to dinner'));
    // Back to Food, as the prototype's sheet closes, once the writes have landed.
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(stored(db, 'food_logs')).toHaveLength(1);
    const [log] = stored(db, 'food_logs');
    expect(log).toMatchObject({ meal: 'Dinner', date: '2026-10-08', qty: 1.5, name: 'Dal (home-style)' });
    const mine = await loadUserFoods(db);
    expect(mine.map((f) => f.name).sort()).toEqual(['Dal (home-style)', 'Other']);
    const saved = mine.find((f) => f.name === 'Dal (home-style)')!;
    expect(saved).toMatchObject({ origin: 'recipe', unit: '1 katori' });
    expect(log!.food_id).toBe(saved.id);
    const [rec] = await loadRecipes(db);
    expect(rec).toMatchObject({ name: 'Dal (home-style)', yield_mode: 'katori', katoris: 5, cooked_g: null, oil: 'normal' });
    expect(rec!.ingredients[0]).toEqual({ ingredient: 'Toor dal (dry)', amount: 150, unit: 'g' });
  });

  it('Save only does not log, and saving over an edited, renamed recipe tombstones the old food', async () => {
    const db = memoryDb();
    await setup(db);
    await fireEvent.press(screen.getByLabelText('Rajma'));
    await fireEvent.changeText(screen.getByLabelText('Recipe name'), 'Rajma');
    await fireEvent.press(screen.getByLabelText('Save only'));
    expect(await screen.findByText('Saved Rajma to your foods')).toBeTruthy();
    await waitFor(async () => expect(await loadRecipes(db)).toHaveLength(1));
    expect(stored(db, 'food_logs')).toHaveLength(0);
    // The saved recipe shows as a chip; load it, rename it, save.
    await waitFor(() => expect(screen.getAllByLabelText('Rajma')).toHaveLength(2));
    await fireEvent.press(screen.getAllByLabelText('Rajma')[0]!);
    await fireEvent.changeText(screen.getByLabelText('Recipe name'), 'Rajma chawal');
    await fireEvent.press(screen.getByLabelText('Save only'));
    await waitFor(async () => expect((await loadRecipes(db)).map((r) => r.name)).toEqual(['Rajma chawal']));
    expect((await loadUserFoods(db)).map((f) => f.name)).toEqual(['Rajma chawal']);
    const old = stored(db, 'user_foods').find((f) => f.name === 'Rajma')!;
    expect(old.deleted_at).toEqual(expect.any(String));
    expect(stored(db, 'recipes')).toHaveLength(1);
  });

  it('merges with my foods as stored at save time: the 80 cap tombstones the oldest, a same-name food keeps its id', async () => {
    const db = memoryDb();
    await setup(db);
    // Seeded after the screen loaded, so only a re-read at write time sees them.
    for (let i = 0; i < 80; i++) db.rows.set(`user_foods:f${i}`, JSON.stringify(food(`Food ${i}`, { id: `f${i}`, updated_at: `2026-09-${String(10 + Math.floor(i / 10)).padStart(2, '0')}T0${i % 10}:00:00Z` })));
    db.rows.set('user_foods:same', JSON.stringify(food('Dal (home-style)', { id: 'same', version: 4 })));
    await fireEvent.press(screen.getByLabelText('Dal'));
    await fireEvent.press(screen.getByLabelText('Save only'));
    await waitFor(async () => expect((await loadUserFoods(db)).some((f) => f.origin === 'recipe')).toBe(true));
    const all = stored(db, 'user_foods');
    const dal = all.filter((f) => f.name === 'Dal (home-style)');
    expect(dal).toHaveLength(1);
    expect(dal[0]).toMatchObject({ id: 'same', version: 4, origin: 'recipe', deleted_at: null });
    const live = await loadUserFoods(db);
    expect(live).toHaveLength(80);
    // 81 foods in all; the one pushed out (the oldest) is a tombstone, not gone.
    const gone = all.filter((f) => f.deleted_at);
    expect(gone).toHaveLength(1);
    expect(gone[0]!.name).toBe('Food 0');
  });

  it('says what is missing instead of saving', async () => {
    const db = memoryDb();
    await setup(db);
    await fireEvent.press(screen.getByLabelText('Save only'));
    expect(await screen.findByText('Give the recipe a name.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Recipe name'), 'Test');
    await fireEvent.press(screen.getByLabelText('Save only'));
    expect(await screen.findByText('Add at least one ingredient with an amount.')).toBeTruthy();
    expect(stored(db, 'recipes')).toHaveLength(0);
  });

  it('lets you pick another ingredient and change the unit', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('Ingredient 1: Toor dal (dry). Tap to change'));
    await fireEvent.changeText(screen.getByLabelText('Search ingredients'), 'paneer');
    await fireEvent.press(screen.getByLabelText('Paneer'));
    expect(screen.getByLabelText('Ingredient 1: Paneer. Tap to change')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Unit for ingredient 1: g. Tap to change'));
    expect(screen.getByLabelText('Unit for ingredient 1: tsp. Tap to change')).toBeTruthy();
  });

  it('skips saved recipes of the wrong shape and tombstones', async () => {
    const db = memoryDb();
    const ok = { id: 'r1', version: 1, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Good one', ingredients: [{ ingredient: 'Onion', amount: 50, unit: 'g' }], yield_mode: 'katori', katoris: 2, cooked_g: null, oil: 'low' };
    db.rows.set('recipes:r1', JSON.stringify(ok));
    db.rows.set('recipes:r2', JSON.stringify({ ...ok, id: 'r2', name: 'Gone', deleted_at: '2026-10-02T00:00:00Z' }));
    db.rows.set('recipes:r3', JSON.stringify({ ...ok, id: 'r3', name: 'Broken', ingredients: 'soup' }));
    db.rows.set('recipes:r4', 'not json');
    await setup(db);
    expect(screen.getByLabelText('Good one')).toBeTruthy();
    expect(screen.queryByLabelText('Gone')).toBeNull();
    expect(screen.queryByLabelText('Broken')).toBeNull();
  });

  it('Back waits for the queued writes, and a second press does nothing', async () => {
    const db = memoryDb();
    db.lag = () => 30;
    const { onBack } = await setup(db);
    await fireEvent.press(screen.getByLabelText('Dal'));
    await fireEvent.press(screen.getByLabelText('Save only'));
    await fireEvent.press(screen.getByLabelText('Back'));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).not.toHaveBeenCalled();
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 80));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(stored(db, 'recipes')).toHaveLength(1);
  });

  it('logs to the meal Recipes was opened from', async () => {
    const db = memoryDb();
    const onBack = jest.fn();
    await render(<RecipesScreen db={db} onBack={onBack} meal="Snacks" now={NOW} />);
    await screen.findByRole('header', { name: 'Recipes' });
    await fireEvent.press(screen.getByLabelText('Dal'));
    await fireEvent.press(screen.getByLabelText('Save and add to snacks'));
    await waitFor(() => expect(stored(db, 'food_logs')).toHaveLength(1));
    expect(stored(db, 'food_logs')[0]).toMatchObject({ meal: 'Snacks' });
  });

  it('shows an error with Back when the saved recipes cannot be read', async () => {
    const db = memoryDb();
    db.getAllAsync = () => Promise.reject(new Error('disk'));
    const onBack = jest.fn();
    await render(<RecipesScreen db={db} onBack={onBack} now={NOW} />);
    expect(await screen.findByText('Couldn’t read your saved recipes.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });
});

describe('Recipes screen: library and cooking mode', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('has the nine library recipes; one shows its tags, time and steps', async () => {
    await setup();
    expect(library).toHaveLength(9);
    const l = library[0]!;
    await fireEvent.press(screen.getByLabelText(l.name));
    expect(screen.getByText(`${l.tags}, about ${l.time_min} min, cost: ${l.cost!.toLowerCase()}`)).toBeTruthy();
    expect(screen.getByText(`1. ${l.steps![0]}`)).toBeTruthy();
  });

  it('cooking mode steps through, runs a timer for a step that gives minutes, and ends with Done', async () => {
    await setup();
    const l = library.find((x) => x.name === 'Soya chunk pulao')!;
    await fireEvent.press(screen.getByLabelText(l.name));
    await fireEvent.press(screen.getByLabelText('Cooking mode'));
    expect(screen.getByText(`Step 1 of ${l.steps!.length}`)).toBeTruthy();
    expect(stepMinutes(l.steps![0]!)).toBe(10);
    // Only the page's own Back: the first step has no Back of its own.
    expect(screen.getAllByLabelText('Back')).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText('Start 10-minute timer'));
    await act(async () => void jest.advanceTimersByTime(3000));
    expect(screen.getByLabelText('9:57 left, tap to stop')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('9:57 left, tap to stop'));
    expect(screen.getByLabelText('Start 10-minute timer')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Next step'));
    expect(screen.getAllByLabelText('Back')).toHaveLength(2);
    await fireEvent.press(screen.getAllByLabelText('Back')[1]!);
    expect(screen.getByText(`Step 1 of ${l.steps!.length}`)).toBeTruthy();
    for (let i = 1; i < l.steps!.length; i++) await fireEvent.press(screen.getByLabelText('Next step'));
    expect(screen.getByText(`Step ${l.steps!.length} of ${l.steps!.length}`)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(screen.getByText('Enjoy your meal')).toBeTruthy();
    expect(screen.queryByLabelText('Next step')).toBeNull();
  });

  it('a timer that runs out says so', async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText('Egg bhurji'));
    await fireEvent.press(screen.getByLabelText('Cooking mode'));
    await fireEvent.press(screen.getByLabelText('Start 3-minute timer'));
    await act(async () => void jest.advanceTimersByTime(181000));
    expect(screen.getByText('Timer done')).toBeTruthy();
  });
});
