import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { loadSettings, saveSettings } from '../src/db/settings';
import { DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET, DEFAULT_PROTEIN_TARGET } from '@plate-and-bar/core';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { getCuisines } from '../src/food/catalog';
import { toastMs } from '../src/food/copy';
import { trackWrite } from '../src/db/pendingWrites';
import { memoryDb, withProfile } from './helpers';
import { postToast, resetPendingToast } from '../src/state/pendingToast';

// Pressable folds aria-expanded into accessibilityState before the host view, so record what the card hands to it.
const mockPressed: Record<string, unknown>[] = [];
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const Actual = jest.requireActual('react-native/Libraries/Components/Pressable/Pressable').default;
  return { __esModule: true, default: (p: Record<string, unknown>) => { mockPressed.push(p); return React.createElement(Actual, p); } };
});

const mockFocus = { n: 0 };
const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, navigate: mockNavigate }),
  // Runs the callback when the screen mounts and each time `mockFocus.n` changes on a re-render (the tab being shown again).
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [mockFocus.n]),
}));
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
async function setup(opts: { flex?: number; withProfile?: boolean; db?: Db; now?: () => Date } = {}) {
  const db = opts.db ?? memoryDb();
  if (opts.withProfile !== false) await saveProfile(db, profile());
  if (opts.flex) await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), flex: [{ id: 'flex-1', date: DATE, kcal_delta: opts.flex }] });
  await render(withProfile(db, <FoodScreen db={db} now={opts.now ?? NOW} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
/** Lets everything already queued run: promise callbacks, then one macrotask turn. No wall-clock delay. */
const flush = () => act(async () => { await new Promise<void>((r) => setImmediate(r)); });
const open = async (meal = 'breakfast') => {
  await fireEvent.press(screen.getByLabelText(`+ Add to ${meal}`));
  await screen.findByLabelText('Search foods');
};

// Toasts clear on a timer. Under heavy load a real one could fire before a test looked for its toast, so the clock is
// fake: a toast stays until a test advances time. Microtasks and setImmediate stay real, so awaited work still runs.
beforeEach(() => {
  resetPendingToast();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
// Run what is still pending first, so an error thrown from a timer (e.g. SettingsProvider's rethrow) fails the test instead of being dropped.
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

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
      if (!screen.queryByLabelText('Plan a bigger day')) await fireEvent.press(screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ }));
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

    it('the ideas card is named by its visible text (no custom label) and exposes expanded', async () => {
      await setup();
      const card = screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ });
      expect(card.props.accessibilityLabel).toBeUndefined();
      // The card is the only unlabelled expandable pressable.
      const handed = () => mockPressed.filter((p) => (p.accessibilityState as { expanded?: boolean } | undefined)?.expanded !== undefined && p.accessibilityLabel === undefined).at(-1);
      expect(handed()?.['aria-expanded']).toBe(false);
      expect(card.props.accessibilityState).toMatchObject({ expanded: false });
      await fireEvent.press(card);
      expect(handed()?.['aria-expanded']).toBe(true);
      expect(screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ }).props.accessibilityState).toMatchObject({ expanded: true });
    });

    it('announces whether the chips are open', async () => {
      await setup();
      await fireEvent.press(screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ }));
      expect(screen.getByLabelText('Plan a bigger day').props.accessibilityState).toMatchObject({ expanded: false });
      await fireEvent.press(screen.getByLabelText('Plan a bigger day'));
      expect(screen.getByLabelText('Plan a bigger day').props.accessibilityState).toMatchObject({ expanded: true });
    });

    it('with two plans on today, the note shows the newest plan’s extra and Undo removes only that plan', async () => {
      const db = await setup();
      await plan('+300 kcal today');
      const first = (await waitFor(async () => {
        const f = await flexOf(db);
        expect(f.length).toBe(4);
        return f;
      }))[0]!.id;
      await plan('+500 kcal today');
      await waitFor(async () => expect((await flexOf(db)).length).toBeGreaterThan(4));
      expect(screen.getByText(/includes \+500 kcal for a bigger meal/)).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Undo bigger day'));
      await waitFor(async () => {
        const left = await flexOf(db);
        expect(left.length).toBe(4);
        expect(left.every((x) => x.id === first)).toBe(true);
      });
      expect(screen.getByLabelText('0 of 2,290 kcal eaten')).toBeTruthy();
      expect(screen.getByText(/includes \+300 kcal for a bigger meal/)).toBeTruthy();
    });

    it('hides Undo on a day that only has cuts', async () => {
      const db = memoryDb();
      await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), flex: [{ id: 'old', date: DATE, kcal_delta: -200 }] });
      await setup({ db });
      expect(screen.getByText(/200 kcal lower/)).toBeTruthy();
      expect(screen.queryByLabelText('Undo bigger day')).toBeNull();
    });

    it('Undo trims the cuts left on a day so it stays at the minimum (floor-aware)', async () => {
      const db = memoryDb();
      // Base target 1,990, floor 1,500. Today has a -1000 cut (p0) and a +500 plan (p1); removing p1 alone would
      // leave 990, so undoFlex trims the cut by 510 and the day lands exactly on the floor.
      await saveSettings(db, {
        ...defaultSettings('2026-10-08T00:00:00Z'),
        flex: [{ id: 'p0', date: DATE, kcal_delta: -1000 }, { id: 'p1', date: DATE, kcal_delta: 500 }],
      });
      await setup({ db });
      await fireEvent.press(screen.getByLabelText('Undo bigger day'));
      const left = await waitFor(async () => {
        const f = await flexOf(db);
        expect(f.some((x) => x.id === 'p1')).toBe(false);
        return f;
      });
      expect(left).toEqual([{ id: 'p0', date: DATE, kcal_delta: -490 }]);
      expect(screen.getByLabelText('0 of 1,500 kcal eaten')).toBeTruthy();
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

  describe('ideas card', () => {
    const openCard = async () => fireEvent.press(screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ }));

    it('is closed at first and shows the next meal’s share, three ideas and the diet it filters by', async () => {
      await setup();
      expect(screen.queryByText(/fits breakfast/)).toBeNull();
      await openCard();
      expect(screen.getByText(/fits breakfast, based on what’s left today. Showing all foods./)).toBeTruthy();
      expect(screen.getAllByLabelText(/^Add .* to breakfast$/)).toHaveLength(3);
    });

    it('Add logs every item of the idea under the meal and moves on', async () => {
      const db = await setup();
      await openCard();
      await fireEvent.press(screen.getAllByLabelText(/^Add .* to breakfast$/)[0]!);
      expect(await screen.findByText('Added to breakfast')).toBeTruthy();
      await waitFor(() => expect(docs(db, 'food_logs').length).toBeGreaterThan(1));
      expect(docs(db, 'food_logs').every((l) => l.meal === 'Breakfast' && l.deleted_at === null)).toBe(true);
      expect(screen.getByRole('button', { name: /What should I eat next\? Lunch ideas/ })).toBeTruthy();
    });

    it('the diet chips filter the ideas and are saved to settings', async () => {
      const db = await setup();
      await openCard();
      await fireEvent.press(screen.getByLabelText('Vegetarian'));
      expect(screen.getByText(/Showing vegetarian foods./)).toBeTruthy();
      expect(screen.getByText('Vegetarian ideas')).toBeTruthy();
      expect(screen.queryByLabelText(/^Add .*(Chicken|Egg).* to breakfast$/)).toBeNull();
      await waitFor(async () => expect((await loadSettings(db))?.diet).toBe('veg'));
    });

    it('Fasting day switches to the fasting pool and is saved on the day note, keeping steps, sleep and the logged-everything tick', async () => {
      const db = memoryDb();
      db.rows.set(`day_notes:${DATE}`, JSON.stringify({ id: null, version: 3, updated_at: '2026-10-08T01:00:00Z', deleted_at: null, date: DATE, complete: true, steps: 7000, sleep: 7.5, fast: false }));
      await setup({ db });
      await openCard();
      await fireEvent.press(screen.getByLabelText('Fasting day'));
      expect(screen.getByLabelText('Fasting day').props.accessibilityState).toMatchObject({ checked: true });
      expect(screen.getAllByLabelText(/^Add .*(Kuttu|Sabudana|Sweet potato).* to breakfast$/).length).toBeGreaterThan(0);
      await waitFor(() => expect(docs(db, 'day_notes')[0]).toMatchObject({ date: DATE, fast: true, complete: true, steps: 7000, sleep: 7.5 }));
    });

    it('refuses a diet change when the saved settings could not be read, and writes nothing', async () => {
      const db = memoryDb();
      const read = db.getFirstAsync.bind(db);
      db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('user_settings')) throw new Error('corrupt');
        return read(sql, ...p);
      }) as typeof db.getFirstAsync;
      await setup({ db });
      await openCard();
      await fireEvent.press(screen.getByLabelText('Vegetarian'));
      expect(await screen.findByText(/Couldn’t read your saved settings/)).toBeTruthy();
      expect(screen.queryByText('Vegetarian ideas')).toBeNull();
      await act(async () => {});
      expect(docs(db, 'user_settings')).toHaveLength(0);
    });

    it('The thali plate guide starts collapsed', async () => {
      await setup();
      await openCard();
      expect(screen.queryByText(/^No counting needed/)).toBeNull();
      await fireEvent.press(screen.getByLabelText('The thali plate guide'));
      expect(screen.getByText(/^No counting needed/)).toBeTruthy();
      // The drawing adds nothing to the text, so it is hidden from screen readers (web and native).
      expect(screen.getByTestId('plate-svg', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    });

    it('More ideas pages through the rest', async () => {
      await setup();
      await openCard();
      const first = screen.getAllByLabelText(/^Add .* to breakfast$/)[0]!.props.accessibilityLabel;
      await fireEvent.press(screen.getByLabelText(/^More ideas \(1 of \d+\)$/));
      expect(screen.getAllByLabelText(/^Add .* to breakfast$/)[0]!.props.accessibilityLabel).not.toBe(first);
    });

    it('says the calories are reached instead of ideas', async () => {
      const db = memoryDb();
      await saveProfile(db, profile());
      const nowDay = '2026-10-08T00:00:00Z';
      for (const [i, kcal] of [1000, 1000].entries()) {
        db.rows.set(`food_logs:l${i}`, JSON.stringify({ id: `l${i}`, version: 0, updated_at: nowDay, deleted_at: null, date: DATE, meal: 'Breakfast', name: 'X', qty: 1, kcal, protein_g: 10, carbs_g: 0, fat_g: 0, food_id: null }));
      }
      await setup({ db });
      await fireEvent.press(screen.getByRole('button', { name: /What should I eat next\? Lunch ideas/ }));
      expect(screen.getByText(/You’ve reached today’s calories/)).toBeTruthy();
      expect(screen.queryByLabelText('Fasting day')).toBeNull();
    });
  });

  it('logs a food by servings into SQLite at once, with running totals and the fibre row', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText('More servings'));
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    await screen.findByText('Added Roti / chapati ×1.5');
    await fireEvent.press(screen.getByText('Done'));
    expect(screen.getByLabelText('153 of 1,990 kcal eaten')).toBeTruthy();
    expect(screen.getByText(/5 of \d+ g/)).toBeTruthy();
    expect(screen.getByText(/of 5 servings/)).toBeTruthy();
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ date: DATE, meal: 'Breakfast', name: 'Roti / chapati', qty: 1.5, kcal: 102, deleted_at: null });
  });

  it('the fibre Why card states that day’s target (flex included), the same as the fibre row', async () => {
    await setup({ flex: 300 });
    await open();
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    await screen.findByText('Added Roti / chapati');
    await fireEvent.press(screen.getByText('Done'));
    expect(screen.getByText(/of 34 g/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Why? Why track fibre and fruit and veg?'));
    expect(await screen.findByText(/which is about 34 g/)).toBeTruthy();
  });

  it('logs by grams, with the dry-weight hint, and refuses too-small amounts and non-gram servings', async () => {
    const db = await setup();
    await open('lunch');
    expect(screen.getByText(/dry or ingredient weight/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '1');
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    expect(await screen.findByText(/too small to log/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '75');
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    await screen.findByText('Added Roti / chapati (75 g)');
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '50');
    await fireEvent.press(screen.getByLabelText(/^Egg, whole/));
    expect(await screen.findByText(/is measured in .*, not grams. Use servings./)).toBeTruthy();
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ meal: 'Lunch', qty: 2.5 });
  });

  it('shows grams typed with a unit without NaN, the source hint, and no badge on eat-out rows', async () => {
    await setup();
    await open();
    expect(screen.getByText(/calculated from USDA public-domain/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount in grams'), '75 g');
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    expect(await screen.findByText('Added Roti / chapati (75 g)')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Eating out'));
    expect(screen.queryByText(/high protein/)).toBeNull();
  });

  it('searches the bundled foods and marks high protein', async () => {
    await setup();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'chawal');
    expect(screen.getByLabelText(/^Rice, cooked/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Roti \/ chapati/)).toBeNull();
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
    expect(screen.queryByLabelText('Why? Alcohol and training')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Drinks'));
    expect(screen.getByLabelText('Why? Alcohol and training')).toBeTruthy();
    const beer = getCuisines().find((c) => c.name === 'Drinks')!.dishes[0]!;
    await fireEvent.press(screen.getByLabelText(new RegExp(`^${beer.name.replace(/[()]/g, '\\$&')}.*tap to add$`)));
    await screen.findByText(`Added ${beer.name}`);
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ name: beer.name, qty: 1, kcal: beer.per_serving.kcal, food_id: beer.id });
  });

  it('every food row is named from its visible text: name, kcal, then the detail line (WCAG 2.5.3, #800)', async () => {
    await setup();
    await open();
    expect(screen.getAllByText(/^[\d,]+ kcal$/).length).toBeGreaterThan(0);
    const rows = screen.getAllByLabelText(/, tap to add$/);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const name = row.props.accessibilityLabel as string;
      expect(name).not.toMatch(/^Add /);
      expect(name).toMatch(/ [\d,]+ kcal .*g protein.*, tap to add$/);
      // The name starts with the row's visible texts joined in reading order (WCAG 2.5.3).
      const visible = within(row).getAllByText(/./).map((t) => [t.props.children].flat().join('').trim()).join(' ');
      expect(visible).not.toBe('');
      expect(name.startsWith(visible)).toBe(true);
    }
  });

  it('a serving unit over 100 characters blocks only when the food is saved to my foods', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText('Custom'));
    await fireEvent.changeText(screen.getByLabelText('Food'), 'Canteen thali');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '500');
    await fireEvent.changeText(screen.getByLabelText('Serving size'), 'u'.repeat(101));
    await fireEvent(screen.getByLabelText('Save to my foods for next time'), 'valueChange', false);
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    await waitFor(() => expect(screen.queryByLabelText('Search foods')).toBeNull());
    expect(docs(db, 'user_foods')).toHaveLength(0);
    expect(docs(db, 'food_logs')).toHaveLength(1);
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
    await fireEvent.changeText(screen.getByLabelText('Serving size'), 'u'.repeat(101));
    await fireEvent.press(screen.getByLabelText('Add to breakfast'));
    expect(await screen.findByText('That serving size is too long. Shorten it.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Serving size'), '');
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
    expect(await screen.findByLabelText(/^Canteen thali/)).toBeTruthy();
  });

  it('deletes a log as a tombstone and keeps it out of the totals', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    await screen.findByText(/Added Roti/);
    await fireEvent.press(screen.getByText('Done'));
    await fireEvent.press(screen.getByLabelText('Remove Roti / chapati'));
    expect(screen.getByLabelText('0 of 1,990 kcal eaten')).toBeTruthy();
    await waitFor(() => expect(docs(db, 'food_logs')[0].deleted_at).not.toBeNull());
  });

  it('writes the "logged everything" tick as DayNote.complete and reads it back', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
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
    await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
    await act(async () => {});
    expect(await screen.findByText('Added Roti / chapati')).toBeTruthy();
    await fireEvent.press(screen.getByText('Done'));
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeTruthy();
  });

  describe('recipes', () => {
    afterEach(() => void (mockFocus.n = 0));

    it('opens the Recipes screen', async () => {
      await setup();
      await fireEvent.press(screen.getByLabelText('Recipes for dinner: build a recipe, the library and cooking mode'));
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/recipes', params: { meal: 'Dinner' } });
    });

    it('reads the day again when the tab is shown after a recipe was logged', async () => {
      const db = await setup();
      expect(screen.queryByText('Dal (home-style)')).toBeNull();
      const log = { id: 'l1', version: 0, updated_at: '2026-10-08T05:00:00Z', deleted_at: null, date: DATE, meal: 'Lunch', name: 'Dal (home-style)', qty: 1, kcal: 200, protein_g: 10, carbs_g: 30, fat_g: 5, food_id: null };
      db.rows.set('food_logs:l1', JSON.stringify(log));
      mockFocus.n++;
      await screen.rerender(withProfile(db, <FoodScreen db={db} now={NOW} />));
      expect(await screen.findByText('Dal (home-style)')).toBeTruthy();
    });
  });

  describe('copy previous day', () => {
    const prev = { id: 'p1', version: 3, updated_at: '2026-10-07T05:00:00Z', deleted_at: null, date: '2026-10-07', meal: 'Lunch', name: 'Gone dal', qty: 2, kcal: 200, protein_g: 10, carbs_g: 30, fat_g: 5, food_id: 'no-such-food' };

    it('copies yesterday’s logs as stored, with new ids, and says so', async () => {
      const db = memoryDb();
      db.rows.set('food_logs:p1', JSON.stringify(prev));
      db.rows.set('food_logs:p2', JSON.stringify({ ...prev, id: 'p2', meal: 'Dinner', name: 'Rice', deleted_at: null }));
      db.rows.set('food_logs:p3', JSON.stringify({ ...prev, id: 'p3', deleted_at: '2026-10-07T06:00:00Z' }));
      await setup({ db });
      await fireEvent.press(screen.getByLabelText('Copy previous day'));
      expect(await screen.findByText('Copied the previous day’s meals')).toBeTruthy();
      expect(screen.queryByLabelText('Copy previous day')).toBeNull();
      await waitFor(() => expect(docs(db, 'food_logs').filter((l) => l.date === DATE)).toHaveLength(2));
      const today = docs(db, 'food_logs').filter((l) => l.date === DATE);
      expect(today.map((l) => `${l.meal}:${l.name}`).sort()).toEqual(['Dinner:Rice', 'Lunch:Gone dal']);
      const copy = today.find((l) => l.name === 'Gone dal');
      expect(copy).toMatchObject({ meal: 'Lunch', qty: 2, kcal: 200, version: 0, food_id: 'no-such-food', updated_at: NOW().toISOString().replace(/\.\d{3}Z$/, 'Z'), deleted_at: null });
      expect(today.every((l) => !['p1', 'p2'].includes(l.id))).toBe(true);
    });

    /** Holds the copy's read of yesterday until `release` runs, so the day can change while the copy is mid-read. */
    const holdCopyRead = (db: Db) => {
      let release!: () => void;
      const held = new Promise<void>((r) => { release = r; });
      const read = db.getAllAsync;
      db.getAllAsync = (async <T,>(sql: string, ...p: (string | number)[]) =>
        sql.includes('FROM food_logs WHERE log_date') && p[0] === '2026-10-07' ? held.then(() => read<T>(sql, ...p)) : read<T>(sql, ...p)) as Db['getAllAsync'];
      return { release, restore: () => void (db.getAllAsync = read) };
    };

    it('copies nothing and says nothing when a log for today lands while the previous day is still being read', async () => {
      const db = memoryDb();
      db.rows.set('food_logs:p1', JSON.stringify(prev));
      await setup({ db });
      const { release, restore } = holdCopyRead(db);
      await act(async () => { fireEvent.press(screen.getByLabelText('Copy previous day')); });
      // Still mid-read: log a food for today, as another screen or a sync pull would.
      await open();
      await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
      await screen.findByText(/Added Roti/);
      await fireEvent.press(screen.getByText('Done'));
      await act(async () => release());
      await flush();
      expect(docs(db, 'food_logs').filter((l) => l.date === DATE).map((l) => l.name)).toEqual(['Roti / chapati']);
      expect(screen.queryByText('Copied the previous day’s meals')).toBeNull();
      restore();
    });

    it('says yesterday had nothing when a log for today lands while that read is in flight', async () => {
      const db = memoryDb();
      await setup({ db });
      const { release, restore } = holdCopyRead(db);
      await act(async () => { fireEvent.press(screen.getByLabelText('Copy previous day')); });
      await open();
      await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
      await screen.findByText(/Added Roti/);
      await fireEvent.press(screen.getByText('Done'));
      release();
      expect(await screen.findByText('Nothing was logged the day before.')).toBeTruthy();
      expect(docs(db, 'food_logs').filter((l) => l.date === DATE).map((l) => l.name)).toEqual(['Roti / chapati']);
      restore();
    });

    it('copies once when the button is pressed twice at once', async () => {
      const db = memoryDb();
      db.rows.set('food_logs:p1', JSON.stringify(prev));
      await setup({ db });
      let prevReads = 0;
      const read = db.getAllAsync;
      db.getAllAsync = (async <T,>(sql: string, ...p: (string | number)[]) => {
        if (sql.includes('FROM food_logs WHERE log_date') && p[0] === '2026-10-07') prevReads++;
        return read<T>(sql, ...p);
      }) as Db['getAllAsync'];
      const btn = screen.getByLabelText('Copy previous day');
      await act(async () => {
        fireEvent.press(btn);
        fireEvent.press(btn);
      });
      await waitFor(() => expect(docs(db, 'food_logs').filter((l) => l.date === DATE)).toHaveLength(1));
      await flush();
      expect(docs(db, 'food_logs').filter((l) => l.date === DATE)).toHaveLength(1);
      // The ref drops the second tap before it reads, so yesterday is read once.
      expect(prevReads).toBe(1);
      db.getAllAsync = read;
    });

    it('says so when the saved food cannot be read', async () => {
      const db = memoryDb();
      await setup({ db });
      const read = db.getAllAsync.bind(db);
      db.getAllAsync = (async () => { throw new Error('boom'); }) as typeof db.getAllAsync;
      await fireEvent.press(screen.getByLabelText('Copy previous day'));
      expect(await screen.findByText('Couldn’t read your saved food.')).toBeTruthy();
      db.getAllAsync = read;
    });

    it('says so when yesterday had nothing', async () => {
      const db = await setup();
      await fireEvent.press(screen.getByLabelText('Copy previous day'));
      expect(await screen.findByText('Nothing was logged the day before.')).toBeTruthy();
      expect(docs(db, 'food_logs')).toHaveLength(0);
    });

    it('says yesterday had nothing again when Copy is pressed twice in a row on an empty day', async () => {
      const db = await setup();
      const says = 'Nothing was logged the day before.';
      await fireEvent.press(screen.getByLabelText('Copy previous day'));
      expect(await screen.findByText(says)).toBeTruthy();
      // Let the first toast go, so the second press has to speak for itself: were the copy left in flight (a stuck
      // `copying` ref), the day is still empty, the button is still offered, and this press would be silent.
      await act(async () => void jest.advanceTimersByTime(toastMs(says) + 1));
      expect(screen.queryByText(says)).toBeNull();
      await fireEvent.press(screen.getByLabelText('Copy previous day'));
      expect(await screen.findByText(says)).toBeTruthy();
      expect(docs(db, 'food_logs')).toHaveLength(0);
    });
  });

  describe('re-reading when shown', () => {
    afterEach(() => void (mockFocus.n = 0));
    const refocus = async (db: Db) => {
      mockFocus.n++;
      await screen.rerender(withProfile(db, <FoodScreen db={db} now={NOW} />));
    };
    const log = (id: string, name: string) => ({ id, version: 0, updated_at: '2026-10-08T05:00:00Z', deleted_at: null, date: DATE, meal: 'Lunch', name, qty: 1, kcal: 200, protein_g: 10, carbs_g: 30, fat_g: 5, food_id: null });

    it('waits for writes registered by other screens before reading', async () => {
      const db = await setup();
      let release!: () => void;
      trackWrite(new Promise<void>((r) => (release = r)).then(() => void db.rows.set('food_logs:l9', JSON.stringify(log('l9', 'Late dal')))));
      await refocus(db);
      await flush();
      expect(screen.queryByText('Late dal')).toBeNull();
      release();
      expect(await screen.findByText('Late dal')).toBeTruthy();
    });

    it('keeps a food just added when the tab is shown while its write is still queued', async () => {
      const db = await setup();
      // The write stays queued until the test opens the gate, so the read cannot see the row before then.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      db.hold = () => gate;
      await open();
      await fireEvent.press(screen.getByLabelText(/^Roti/));
      await fireEvent.press(screen.getByText('Done'));
      expect(screen.getByLabelText('Remove Roti / chapati')).toBeTruthy();
      await refocus(db);
      await flush();
      // Without waiting for the queue, the read would not have seen the row and would replace the day with an empty one.
      expect(screen.getByLabelText('Remove Roti / chapati')).toBeTruthy();
      await act(async () => release());
      await flush();
      expect(screen.getByLabelText('Remove Roti / chapati')).toBeTruthy();
      expect(docs(db, 'food_logs')).toHaveLength(1);
    });

    it('drops an older read when the user wrote while it ran', async () => {
      const db = await setup();
      const real = db.getAllAsync.bind(db);
      // Reads that start while `slow` hold their (by then stale) result until the test opens the gate.
      let slow = true;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
        const out = await real(sql, ...p);
        if (slow && sql.includes('FROM food_logs')) await gate;
        return out;
      }) as typeof db.getAllAsync;
      await refocus(db);
      await open();
      await fireEvent.press(screen.getByLabelText(/^Roti/));
      await fireEvent.press(screen.getByText('Done'));
      // The just-added food shows while the stale read is still held.
      expect(screen.getByLabelText('Remove Roti / chapati')).toBeTruthy();
      slow = false;
      await act(async () => release());
      await flush();
      expect(screen.getAllByText(/Roti/).length).toBeGreaterThan(0);
    });

    it('says so, instead of loading forever, when the day cannot be read', async () => {
      const db = memoryDb();
      db.getAllAsync = () => Promise.reject(new Error('disk'));
      await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
      expect(await screen.findByText(/Couldn’t read your saved food\. Restart/)).toBeTruthy();
    });
  });
});

describe('Estimated burn today so far', () => {
  it('shows core’s burnToday as a range with a breakdown under Details', async () => {
    await setup();
    // 82 kg, 165 cm, 30, sitting (0.15), no steps or food: bmr 1,706.25 + movement 255.9 = 1,962.2; range -10% / +10%.
    expect(await screen.findByLabelText('Estimated burn today so far, 1,766–2,158 kcal')).toBeTruthy();
    expect(screen.queryByLabelText('Resting, 1,706 kilocalories')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Show burn details'));
    expect(screen.getByLabelText('Resting, 1,706 kilocalories')).toBeTruthy();
    expect(screen.getByLabelText('Daily movement, from your activity level, 256 kilocalories')).toBeTruthy();
    expect(screen.getByLabelText('Training, nothing logged yet, 0 kilocalories')).toBeTruthy();
  });
});

describe('Meal prep on Food', () => {
  const batch = (over: Record<string, unknown> = {}) => ({ id: 'b1', name: 'Dal (home-style)', meal: 'Lunch' as const, left: 3, until: '2026-10-14', food: { kcal: 161, protein_g: 7.8, carbs_g: 23.3, fat_g: 4.6 }, ...over });
  async function withPrep(prep: ReturnType<typeof batch>[]) {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), prep });
    await setup({ db });
    return db;
  }
  const settingsPrep = async (db: Db) => (await loadSettings(db))!.prep;

  it('shows the batch under its meal with the prototype copy and a labelled Log 1 katori', async () => {
    await withPrep([batch()]);
    expect(await screen.findByText('Meal prep: Dal (home-style), 3 portions left')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log 1 katori of Dal (home-style) to lunch' })).toBeTruthy();
  });

  it('Log 1 katori logs one portion under that meal and takes one off the batch, saved at once', async () => {
    const db = await withPrep([batch()]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Log 1 katori of Dal (home-style) to lunch' }));
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(1));
    expect(docs(db, 'food_logs')[0]).toMatchObject({ meal: 'Lunch', name: 'Dal (home-style)', qty: 1, kcal: 161, protein_g: 7.8, carbs_g: 23.3, fat_g: 4.6, date: DATE, deleted_at: null });
    expect(screen.getByText('Meal prep: Dal (home-style), 2 portions left')).toBeTruthy();
    expect(screen.getByText('Logged Dal (home-style)')).toBeTruthy();
    await waitFor(async () => expect(((await settingsPrep(db))[0] as { left: number }).left).toBe(2));
  });

  it('says "1 portion left" and the line goes when the last one is logged; a second tap logs nothing more', async () => {
    const db = await withPrep([batch({ left: 2 })]);
    const press = () => fireEvent.press(screen.getByRole('button', { name: 'Log 1 katori of Dal (home-style) to lunch' }));
    await press();
    expect(await screen.findByText('Meal prep: Dal (home-style), 1 portion left')).toBeTruthy();
    await press();
    await waitFor(() => expect(screen.queryByText(/^Meal prep:/)).toBeNull());
    expect(screen.queryByRole('button', { name: /^Log 1 katori/ })).toBeNull();
    await waitFor(() => expect(docs(db, 'food_logs')).toHaveLength(2));
    await waitFor(async () => expect(((await settingsPrep(db))[0] as { left: number }).left).toBe(0));
  });

  it('leaves out other meals, used-up batches and expired ones (the last day still shows)', async () => {
    await withPrep([batch({ id: 'a', name: 'Dinner dish', meal: 'Dinner' }), batch({ id: 'b', name: 'Empty', left: 0 }), batch({ id: 'c', name: 'Expired', until: '2026-10-07' }), batch({ id: 'd', name: 'Last day', until: '2026-10-08' })]);
    expect(await screen.findByText('Meal prep: Dinner dish, 3 portions left')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log 1 katori of Dinner dish to dinner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log 1 katori of Last day to lunch' })).toBeTruthy();
    expect(screen.queryByText(/Empty/)).toBeNull();
    expect(screen.queryByText(/Expired/)).toBeNull();
  });
});

describe('Weekly check-in banner', () => {
  const SUNDAY = () => new Date(2026, 9, 18, 10, 0, 0);
  const MONDAY = () => new Date(2026, 9, 19, 10, 0, 0);
  const TUESDAY = () => new Date(2026, 9, 20, 10, 0, 0);
  async function on(now: () => Date, seen: string | null = null) {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), checkin_seen: seen });
    await setup({ db, now });
  }

  it('shows on a Sunday, and See it opens Progress', async () => {
    mockNavigate.mockClear();
    await on(SUNDAY);
    expect(screen.getByText('Your weekly check-in is ready.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'See it: your weekly check-in' }));
    expect(mockNavigate).toHaveBeenCalledWith('/progress');
  });

  it('shows on a Monday when only last week’s check-in was seen', async () => {
    await on(MONDAY, '2026-10-12');
    expect(screen.getByText('Your weekly check-in is ready.')).toBeTruthy();
  });

  it('is gone once this week’s check-in was seen', async () => {
    await on(MONDAY, '2026-10-19');
    expect(screen.queryByText('Your weekly check-in is ready.')).toBeNull();
  });

  it('does not show on a Tuesday or a Thursday', async () => {
    await on(TUESDAY);
    expect(screen.queryByText('Your weekly check-in is ready.')).toBeNull();
    await screen.unmount();
    await on(NOW);
    expect(screen.queryByText('Your weekly check-in is ready.')).toBeNull();
  });
});

describe('Low on protein add-on', () => {
  const seed = (db: Db, rows: { id: string; meal: string; name: string; kcal: number; protein_g: number; qty?: number }[]) => {
    for (const r of rows) db.rows.set(`food_logs:${r.id}`, JSON.stringify({ version: 0, updated_at: '2026-10-08T00:00:00Z', deleted_at: null, date: DATE, qty: 1, carbs_g: 0, fat_g: 0, food_id: null, ...r }));
  };
  const lunch = [{ id: 'l1', meal: 'Lunch', name: 'Roti / chapati', kcal: 102, protein_g: 4 }];

  it('shows the prototype line for a main meal under 20 g, with a labelled Add', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    seed(db, lunch);
    await setup({ db });
    expect(await screen.findByText('Low on protein. Add whey protein (1 scoop): +24 g protein, 120 kcal.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add whey protein (1 scoop) to lunch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Why\? .*low protein in lunch$/ })).toBeTruthy();
  });

  it('one tap logs the food under that meal and the line moves on', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    seed(db, lunch);
    await setup({ db });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add whey protein (1 scoop) to lunch' }));
    await waitFor(() => expect(docs(db, 'food_logs').filter((l) => l.name === 'Whey protein')).toHaveLength(1));
    expect(docs(db, 'food_logs').find((l) => l.name === 'Whey protein')).toMatchObject({ meal: 'Lunch', qty: 1, kcal: 120, protein_g: 24, deleted_at: null });
    expect(screen.getByText('Added Whey protein')).toBeTruthy();
    // 28 g now: no longer low
    expect(screen.queryByText(/^Low on protein/)).toBeNull();
  });

  it('suits the diet: a veg diet is not offered egg whites when about 40 kcal are left', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), diet: 'veg' });
    seed(db, [{ id: 'big', meal: 'Dinner', name: 'X', kcal: 1848, protein_g: 40 }, ...lunch]);
    await setup({ db });
    expect(await screen.findByText(/^Low on protein\. Add greek yogurt, plain \(100 g\)/)).toBeTruthy();
    expect(screen.queryByText(/egg whites/)).toBeNull();
  });

  it('logs three egg whites for the egg-white add-on (qty 3, three times the values)', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    seed(db, [{ id: 'big', meal: 'Dinner', name: 'X', kcal: 1848, protein_g: 40 }, ...lunch]);
    await setup({ db });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add 3 egg whites to lunch' }));
    await waitFor(() => expect(docs(db, 'food_logs').filter((l) => l.name === 'Egg white')).toHaveLength(1));
    expect(docs(db, 'food_logs').find((l) => l.name === 'Egg white')).toMatchObject({ meal: 'Lunch', qty: 3, kcal: 17, protein_g: 3.6 });
  });

  it('works out the room from the base target, not the target a flex day raises', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    // base 1,990: 40 kcal left, so egg whites fit; with +300 flex shown (2,290) whey (120 kcal) would fit and win
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), flex: [{ id: 'flex-1', date: DATE, kcal_delta: 300 }] });
    seed(db, [{ id: 'big', meal: 'Dinner', name: 'X', kcal: 1848, protein_g: 40 }, ...lunch]);
    await setup({ db });
    expect(await screen.findByText(/^Low on protein\. Add 3 egg whites/)).toBeTruthy();
  });

  it('is not shown for Snacks, for an empty meal or at 20 g or more', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    seed(db, [{ id: 's', meal: 'Snacks', name: 'Almonds', kcal: 100, protein_g: 3 }, { id: 'b', meal: 'Breakfast', name: 'Eggs', kcal: 200, protein_g: 20 }]);
    await setup({ db });
    await screen.findByText('Almonds');
    expect(screen.queryByText(/^Low on protein/)).toBeNull();
  });
});

describe('toast posted by setup', () => {
  it('shows a message posted before the tab mounted, once', async () => {
    postToast('Targets updated');
    await setup();
    expect(await screen.findByText('Targets updated')).toBeTruthy();
    await screen.unmount();
    await setup();
    expect(screen.queryByText('Targets updated')).toBeNull();
  });
});
