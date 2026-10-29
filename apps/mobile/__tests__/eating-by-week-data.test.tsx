import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { loadLogsBetween, saveLog } from '../src/db/food';
import { saveProfile } from '../src/db/records';
import type { FoodLog } from '../src/food/types';
import { useWeeklyIntake } from '../src/progress/useWeeklyIntake';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { dayQueue } from '../src/workout/dayQueue';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { DEFAULT_KCAL_TARGET } from '@plate-and-bar/core';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';
import { openDb } from './sync-helpers';

const mockFocus = { n: 0 };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [mockFocus.n]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // Thursday; the week began Monday 2026-10-05
type Db = ReturnType<typeof memoryDb>;
let n = 0;
const log = (db: Db, date: string, kcal: number, extra: Partial<FoodLog> = {}) =>
  saveLog(db, { id: `l${n++}`, version: 0, updated_at: '', deleted_at: null, date, meal: 'Lunch', name: 'x', qty: 1, kcal, protein_g: 100, carbs_g: 0, fat_g: 0, food_id: null, ...extra });
const days = async (db: Db, dates: readonly string[], kcal: number) => {
  for (const d of dates) await log(db, d, kcal);
};
const profile = () => buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '175', weight: '82', activity: 'sitting', where: 'gym', days: 3, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const bars = () => screen.queryAllByTestId(/^bar-/, { includeHiddenElements: true }).map((b) => b.props.testID as string);
const queries = (db: Db) => jest.spyOn(db, 'getAllAsync');
const rangeReads = (spy: jest.SpyInstance) => spy.mock.calls.filter((c) => String(c[0]).includes('FROM food_logs WHERE log_date >=')).length;

beforeEach(() => { mockFocus.n = 0; });

describe('EatingByWeek on Progress: data source', () => {
  it('sits under Seven days and above Weeks on track, and reads the stored logs', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await days(db, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'], 2000);
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByRole('header', { name: 'Eating by week' })).toBeTruthy();
    const order = screen.getAllByRole('header').map((h) => h.props.children as string);
    const at = (t: string | RegExp) => order.findIndex((x) => (typeof t === 'string' ? x === t : t.test(String(x))));
    expect(at(/^Seven days to/)).toBeLessThan(at('Eating by week'));
    expect(at('Eating by week')).toBeLessThan(at('Weeks on track'));
    expect(bars()).toEqual(['bar-2026-09-28']);
    expect(screen.getByLabelText(/^2,000 kcal a day, last 4 weeks, target [\d,]+ kcal/)).toBeTruthy();
  });

  it('ignores deleted logs and shows the empty line with nothing logged', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await days(db, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'], 2000);
    await log(db, '2026-10-05', 500, { deleted_at: '2026-10-06T00:00:00Z' });
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText(/^2,000 kcal a day/)).toBeTruthy(); // the deleted 500 is not averaged in
    const empty = memoryDb();
    await saveProfile(empty, profile());
    await render(withProfile(empty, <ProgressScreen db={empty} now={NOW} />));
    expect((await screen.findAllByText('Log food to see your weekly averages here.')).length).toBeGreaterThan(0);
  });

  it('follows the check-in reads: a log saved after mount shows when the tab is shown again', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const view = await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Eating by week' });
    expect(bars()).toEqual([]);
    await days(db, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'], 1800);
    mockFocus.n++;
    await view.rerender(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText(/^1,800 kcal a day/)).toBeTruthy();
    expect(bars()).toEqual(['bar-2026-10-05']);
  });

  it('the table has the protein row and the few-days label on the real screen', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await days(db, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'], 2000);
    await days(db, ['2026-10-05'], 1000);
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Eating by week' });
    const buttons = screen.getAllByRole('button', { name: 'Show as table' });
    await fireEvent.press(buttons[buttons.length - 1]!);
    expect(screen.getByLabelText(/^5 Oct 2026, 1,000 kcal, few days logged, .*Protein 100 g a day$/)).toBeTruthy();
  });
});

describe('EatingByWeek on Progress: reloads and targets', () => {
  it('a sync pull (dataVersion bump) rereads the logs without a refocus', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const at = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db, <ProgressScreen db={db} now={NOW} />)}</SyncContext.Provider>;
    const view = await render(at(0));
    await screen.findByRole('header', { name: 'Eating by week' });
    expect(bars()).toEqual([]);
    await days(db, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'], 1700); // a pull stored these
    await view.rerender(at(1));
    expect(await screen.findByLabelText(/^1,700 kcal a day/)).toBeTruthy();
  });

  it('with no profile the target is the same default as Seven days', async () => {
    const db = memoryDb();
    await days(db, ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'], 1700);
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText(new RegExp(`^1,700 kcal a day, last 4 weeks, target ${DEFAULT_KCAL_TARGET.toLocaleString('en-IN')} kcal`))).toBeTruthy();
  });

  it('loadLogsBetween on real SQLite includes both end days and nothing outside', async () => {
    const db = await openDb();
    for (const [i, d] of ['2026-09-30', '2026-10-01', '2026-10-03', '2026-10-04'].entries()) await log(db as never, d, i + 1);
    expect((await loadLogsBetween(db as never, '2026-10-01', '2026-10-03')).map((l) => l.kcal).sort()).toEqual([2, 3]);
  });

  it('loadLogsBetween is inclusive, bounded and leaves out deleted logs', async () => {
    const db = memoryDb();
    await log(db, '2026-10-01', 1);
    await log(db, '2026-10-03', 2);
    await log(db, '2026-10-04', 3);
    await log(db, '2026-10-02', 4, { deleted_at: '2026-10-05T00:00:00Z' });
    expect((await loadLogsBetween(db, '2026-10-01', '2026-10-03')).map((l) => l.kcal).sort()).toEqual([1, 2]);
  });
});

describe('useWeeklyIntake reloads', () => {
  const run = async (db: Db, date = '2026-10-08', reloadKey = 0) => {
    const r = await renderHook((p: { date: string; k: number }) => useWeeklyIntake({ db, date: p.date, reloadKey: p.k }), { initialProps: { date, k: reloadKey } });
    await act(async () => {});
    return r;
  };

  it('reads once on mount, one query for all 12 weeks, from the first Monday to the viewed day', async () => {
    const db = memoryDb();
    const spy = queries(db);
    const { result } = await run(db);
    expect(rangeReads(spy)).toBe(1);
    expect(spy.mock.calls.find((c) => String(c[0]).includes('log_date >='))?.slice(1)).toEqual(['2026-07-20', '2026-10-08']);
    expect(result.current.days).toEqual([]);
  });

  it('reads again on a new reloadKey, a new date and a focus, and not on an unchanged re-render', async () => {
    const db = memoryDb();
    const spy = queries(db);
    const { rerender } = await run(db);
    await rerender({ date: '2026-10-08', k: 0 });
    await act(async () => {});
    expect(rangeReads(spy)).toBe(1);
    await rerender({ date: '2026-10-08', k: 1 }); // sync pulled records
    await act(async () => {});
    expect(rangeReads(spy)).toBe(2);
    await rerender({ date: '2026-10-01', k: 1 });
    await act(async () => {});
    expect(rangeReads(spy)).toBe(3);
    mockFocus.n++;
    await rerender({ date: '2026-10-01', k: 1 });
    await act(async () => {});
    expect(rangeReads(spy)).toBe(4);
  });

  it('shows no days while another date is read, and fails without throwing', async () => {
    const db = memoryDb();
    await days(db, ['2026-10-01'], 2000);
    const { result, rerender } = await run(db);
    expect(result.current.days).toHaveLength(1);
    const real = db.getAllAsync.bind(db);
    jest.spyOn(db, 'getAllAsync').mockImplementation(((sql: string, ...p: (string | number)[]) => (sql.includes('log_date >=') ? Promise.reject(new Error('boom')) : real(sql, ...p))) as typeof db.getAllAsync);
    await rerender({ date: '2026-10-02', k: 0 });
    await act(async () => {});
    expect(result.current).toEqual({ days: null, failed: true });
    jest.restoreAllMocks();
    await rerender({ date: '2026-10-02', k: 1 });
    await act(async () => {});
    expect(result.current.failed).toBe(false);
    expect(result.current.days).toHaveLength(1);
  });

  it('an error belongs to its date: moving to a date that reads fine shows its days, not the error', async () => {
    const db = memoryDb();
    await days(db, ['2026-10-01'], 2000);
    const real = db.getAllAsync.bind(db);
    jest.spyOn(db, 'getAllAsync').mockImplementation(((sql: string, ...p: (string | number)[]) => (sql.includes('log_date >=') && p[1] === '2026-10-08' ? Promise.reject(new Error('boom')) : real(sql, ...p))) as typeof db.getAllAsync);
    const { result, rerender } = await run(db);
    expect(result.current).toEqual({ days: null, failed: true });
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => { open = r; });
    const failing = db.getAllAsync as unknown as jest.Mock;
    failing.mockImplementation(async (sql: string, ...p: (string | number)[]) => { await gate; return real(sql, ...p); });
    await rerender({ date: '2026-10-02', k: 0 });
    await act(async () => {});
    expect(result.current).toEqual({ days: null, failed: false }); // the old date's error is not shown while the new date reads
    open();
    await act(async () => {});
    expect(result.current.failed).toBe(false);
    expect(result.current.days).toHaveLength(1);
    jest.restoreAllMocks();
  });

  it('waits for queued workout writes before reading, as the check-in does', async () => {
    let release: () => void = () => {};
    dayQueue.current = new Promise<void>((r) => { release = r; });
    const db = memoryDb();
    const spy = queries(db);
    await renderHook(() => useWeeklyIntake({ db, date: '2026-10-08' }));
    await act(async () => {});
    expect(rangeReads(spy)).toBe(0);
    release();
    await act(async () => {});
    expect(rangeReads(spy)).toBe(1);
  });
});
