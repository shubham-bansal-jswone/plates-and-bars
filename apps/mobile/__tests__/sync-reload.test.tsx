import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { RulesSection } from '../src/targets/RulesSection';
import { saveLog } from '../src/db/food';
import { saveWeight } from '../src/db/progress';
import { saveExclusion, loadExclusions } from '../src/db/rules';
import { saveWorkout } from '../src/db/workouts';
import { useFoodDay } from '../src/food/useFoodDay';
import { useProgress } from '../src/progress/useProgress';
import { saveRecipe } from '../src/db/recipes';
import { useRecipes } from '../src/recipes/useRecipes';
import { useRules } from '../src/workout/useRules';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const notify = jest.fn();
const meta = { version: 1, updated_at: '2026-10-08T06:00:00Z', deleted_at: null };
const food = (id: string, name: string) => ({ id, ...meta, date: DATE, meal: 'Lunch' as const, name, qty: 1, kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 2, food_id: null });
const weight = (kg: number) => ({ id: null, ...meta, date: DATE, weight_kg: kg });
const rule = (id: string, name: string) => ({ id, ...meta, name, scope: 'exercise' as const, key: name, reason: 'dislike' as const, created: DATE, until: null, to: {}, done: false });

type Db = Awaited<ReturnType<typeof openDb>>;

/** The database with the next list read held open once it has read its rows: that read straddles whatever the test does meanwhile. */
function gated(db: Db) {
  let markHit = () => {};
  let release = () => {};
  const g = {
    armed: false,
    hit: Promise.resolve(),
    arm() {
      g.armed = true;
      g.hit = new Promise<void>((r) => (markHit = r));
    },
    release: () => release(),
  };
  const getAllAsync = async (...a: Parameters<Db['getAllAsync']>) => {
    const rows = await db.getAllAsync(...a);
    if (!g.armed) return rows;
    g.armed = false;
    const hold = new Promise<void>((r) => (release = r));
    markHit();
    await hold;
    return rows;
  };
  return { g, db: Object.assign(Object.create(db) as Db, { getAllAsync }) };
}

describe('a pull makes the screens read SQLite again (dataVersion)', () => {
  it('Food shows a log that arrived from another device, and keeps its own queued log', async () => {
    const db = await openDb();
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useFoodDay({ db, now: NOW, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.add('Lunch', { name: 'mine', qty: 1, kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }));
    await saveLog(db, food('pulled', 'from phone'));
    await rerender({ k: 1 });
    await waitFor(() => expect(result.current.logs.map((l) => l.name).sort()).toEqual(['from phone', 'mine']));
  });

  it('Food: a log added while the reload is reading is not dropped by the older read', async () => {
    const real = await openDb();
    const { g, db } = gated(real);
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useFoodDay({ db, now: NOW, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    g.arm();
    await rerender({ k: 1 });
    await g.hit; // the reload has read the rows (none) and waits
    await act(async () => result.current.add('Lunch', { name: 'typed meanwhile', qty: 1, kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }));
    g.release();
    await waitFor(async () => expect(await real.getAllAsync('SELECT key FROM food_logs')).toHaveLength(1));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50)))); // the held read lands (or is read again)
    expect(result.current.logs.map((l) => l.name)).toEqual(['typed meanwhile']);
  });

  it('Progress shows a weigh-in that arrived, and keeps one saved while the reload was reading', async () => {
    const real = await openDb();
    const { g, db } = gated(real);
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useProgress({ db, now: NOW, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await saveWeight(real, { ...weight(80), date: '2026-10-01' });
    g.arm();
    await rerender({ k: 1 });
    await g.hit;
    await act(async () => result.current.saveWeightText('81.5'));
    g.release();
    await waitFor(() => expect(result.current.weights.map((w) => w.weight_kg).sort()).toEqual([80, 81.5]));
  });

  it('Workout shows a session that arrived from another device', async () => {
    const db = await openDb();
    const opts = { db, profile: null, now: NOW, focus: [], notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useWorkoutDay({ ...opts, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    expect(result.current.day.workout).toBeNull();
    await saveWorkout(db, { id: null, ...meta, date: DATE, template: 'Upper A', base: 'Upper A', where: 'gym', cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    await rerender({ k: 1 });
    await waitFor(() => expect(result.current.day.workout?.template).toBe('Upper A'));
  });

  it('the rules show an exclusion that arrived, and keep one added while the reload was reading', async () => {
    const real = await openDb();
    const { g, db } = gated(real);
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useRules({ db, now: NOW, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.rules.ready).toBe(true));
    await saveExclusion(real, rule('pulled', 'Barbell Squat'));
    g.arm();
    await rerender({ k: 1 });
    await g.hit;
    await act(async () => void result.current.addRule({ name: 'Lunge', scope: 'exercise', key: 'Lunge', reason: 'dislike', created: DATE, until: null, to: {}, done: false } as never));
    g.release();
    await waitFor(() => expect(result.current.rules.exclusions.map((r) => r.name).sort()).toEqual(['Barbell Squat', 'Lunge']));
    await waitFor(async () => expect(await loadExclusions(real)).toHaveLength(2));
  });
});

describe('the wait for queued writes and the write counter matter', () => {
  it('Food: a reload started while a log is still being written shows the log (it waits for the queued write)', async () => {
    const real = await openDb();
    // Every write takes a while, so the log is still unwritten when the reload starts reading.
    const slow = Object.assign(Object.create(real) as Db, {
      runAsync: async (...a: Parameters<Db['runAsync']>) => {
        await new Promise((r) => setTimeout(r, 60));
        return real.runAsync(...a);
      },
    });
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useFoodDay({ db: slow, now: NOW, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.add('Lunch', { name: 'still writing', qty: 1, kcal: 1, protein_g: 1, carbs_g: 1, fat_g: 1 }));
    await rerender({ k: 1 });
    await act(async () => void (await new Promise((r) => setTimeout(r, 250))));
    expect(result.current.logs.map((l) => l.name)).toEqual(['still writing']);
  });

  it('Workout: a session started while the reload is reading is not replaced by the older read', async () => {
    const real = await openDb();
    const { g, db } = gated(real);
    const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
    const opts = { db, profile, now: NOW, focus: [], notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useWorkoutDay({ ...opts, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    g.arm();
    await rerender({ k: 1 });
    await g.hit; // the reload has read "no workout today" and waits
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    g.release();
    await act(async () => void (await new Promise((r) => setTimeout(r, 80))));
    expect(result.current.day.workout?.base).toBe('Upper A');
    expect(result.current.day.exs.length).toBeGreaterThan(0);
    expect(await real.getFirstAsync("SELECT key FROM workouts WHERE key = '2026-10-08'")).not.toBeNull();
  });

  it('the rules refuse changes and say why when the stored rules could not be read, and write nothing', async () => {
    const real = await openDb();
    const failing = Object.assign(Object.create(real) as Db, { getAllAsync: async () => Promise.reject(new Error('disk')) });
    const say = jest.fn();
    const { result } = await renderHook(() => useRules({ db: failing, now: NOW, notify: say }));
    await waitFor(() => expect(result.current.rules.loadFailed).toBe(true));
    let saved: unknown = 'unset';
    await act(async () => void (saved = result.current.addRule({ name: 'Lunge', scope: 'exercise', key: 'Lunge', reason: 'dislike', created: DATE, until: null, to: {}, done: false } as never)));
    result.current.putSwap({ from: 'A', to: 'B', since: DATE, bridge_until: null });
    result.current.removeRule('x');
    expect(saved).toBeNull();
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/Couldn’t read your saved exercise rules, so changes are not saved/));
    expect(await real.getAllAsync('SELECT key FROM exclusions')).toHaveLength(0);
    expect(await real.getAllAsync('SELECT key FROM swaps')).toHaveLength(0);
    expect(result.current.rules.exclusions).toHaveLength(0);
  });
});

describe('recipes', () => {
  it('show a recipe that arrived from another device', async () => {
    const db = await openDb();
    const { result, rerender } = await renderHook(({ k }: { k: number }) => useRecipes({ db, now: NOW, notify, reloadKey: k }), { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.recipes).toHaveLength(0);
    await saveRecipe(db, { id: 'r1', ...meta, name: 'Dal', ingredients: [{ ingredient: 'Toor dal', amount: 100, unit: 'g' }], yield_mode: 'katori', katoris: 4, cooked_g: null, oil: 'none' });
    await rerender({ k: 1 });
    await waitFor(() => expect(result.current.recipes.map((r) => r.name)).toEqual(['Dal']));
  });
});

describe('screens are wired to the sync dataVersion', () => {
  it('the Targets rules list shows a rule pulled by a sync without a remount', async () => {
    const db = await openDb();
    const at = (dataVersion: number) => (
      <SyncContext.Provider value={{ dataVersion } as SyncState}>
        <RulesSection db={db} today={DATE} now={NOW} notify={notify} />
      </SyncContext.Provider>
    );
    const view = await render(at(0));
    await saveExclusion(db, rule('pulled', 'Barbell Squat'));
    await view.rerender(at(1));
    expect(await screen.findByText(/Barbell Squat/)).toBeTruthy();
  });
});
