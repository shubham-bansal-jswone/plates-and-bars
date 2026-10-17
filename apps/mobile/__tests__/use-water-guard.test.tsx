import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWater } from '../src/food/useWater';
import { memoryDb } from './helpers';

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const notify = () => {};
const rows = (db: ReturnType<typeof memoryDb>) => [...db.rows].filter(([k]) => k.startsWith('water_logs:')).map(([, v]) => JSON.parse(v));

describe('useWater before the viewed day has loaded', () => {
  it('ignores add and undo until the day is read, then works on that day', async () => {
    const db = memoryDb();
    db.rows.set('water_logs:w1', JSON.stringify({ id: 'w1', version: 0, updated_at: '2026-10-08T05:00:00.000Z', deleted_at: null, date: '2026-10-08', ml: 250 }));
    const r = await renderHook(({ date }) => useWater({ db, date, now: NOW, profile: null, notify }), { initialProps: { date: '2026-10-08' } });
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    const read = db.getAllAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((res) => (open = res));
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM water_logs')) await gate;
      return read(sql, ...p);
    }) as typeof db.getAllAsync;
    await r.rerender({ date: '2026-10-07' });
    expect(r.result.current.ready).toBe(false);
    await act(async () => {
      r.result.current.undo();
      r.result.current.add(500);
    });
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ id: 'w1', deleted_at: null });
    await act(async () => open());
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    await act(async () => r.result.current.add(500));
    await waitFor(() => expect(rows(db).map((w) => w.ml).sort()).toEqual([250, 500]));
    expect(rows(db).find((w) => w.ml === 500)).toMatchObject({ date: '2026-10-07' });
  });
});
