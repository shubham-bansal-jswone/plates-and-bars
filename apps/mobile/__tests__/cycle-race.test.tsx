import { act, renderHook, waitFor } from '@testing-library/react-native';
import { emptyCycle } from '@plate-and-bar/core';
import { loadCycle, saveCycle } from '../src/db/cycle';
import { useCycle } from '../src/cycle/useCycle';
import { wipeLocalStore } from '../src/sync/guard';
import { openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));

describe('a wipe cannot land between the cycle log read and its write', () => {
  it('a store wipe started right after the read waits for the write, so nothing of the old log survives', async () => {
    const db = await openDb();
    await saveCycle(db, { on: true, starts: ['2026-09-12'], len: 28 });
    const notify = jest.fn();
    const { result } = await renderHook(() => useCycle({ db, date: '2026-10-08', notify }));
    await waitFor(() => expect(result.current.data?.on).toBe(true));

    // As soon as the change has read the stored log, a wipe starts (not awaited here: it must wait for the lock the change holds).
    const read = db.getFirstAsync.bind(db);
    let wipe: Promise<number> | null = null;
    db.getFirstAsync = async <T,>(sql: string, ...p: (string | number)[]) => {
      const row = await read<T>(sql, ...p);
      if (!wipe && sql.includes('FROM cycle_log')) wipe = wipeLocalStore(db, { force: true });
      return row;
    };
    // The write is slow: a wipe that is not held back by the change's lock would finish before it, and the write would bring the log back.
    const write = db.runAsync.bind(db);
    db.runAsync = async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('INTO cycle_log')) for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r));
      return write(sql, ...p);
    };
    await act(async () => {
      await result.current.logStart('2026-10-01');
      await wipe;
    });
    expect(wipe).not.toBeNull();
    expect(await loadCycle(db)).toEqual(emptyCycle());
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cycle_log'))?.n).toBe(0);
  });
});
