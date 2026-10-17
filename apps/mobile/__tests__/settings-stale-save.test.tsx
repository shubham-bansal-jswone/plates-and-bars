import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { signOut, wipeLocalStore } from '../src/sync/guard';
import { KEY_SETTINGS_KEPT, KEY_USER, getKv, setKv } from '../src/sync/store';
import { memoryTokens, openDb } from './sync-helpers';

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real SQLite where the next read of the settings record can be held (the save is then inside its transaction). */
async function setup() {
  const db = await openDb();
  await setKv(db, KEY_USER, USER);
  await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['abs'] });
  await db.runAsync('DELETE FROM sync_outbox');
  /** While set, the write of the settings record fails (disk full). */
  const failing = { on: false };
  const write = db.runAsync.bind(db);
  db.runAsync = (async (sql: string, ...p: (string | number)[]) => {
    if (failing.on && /INSERT OR REPLACE INTO user_settings/.test(sql)) throw new Error('disk full');
    return write(sql, ...p);
  }) as typeof db.runAsync;
  let armed: { release: Promise<void>; reached: () => void } | null = null;
  const read = db.getFirstAsync.bind(db);
  db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
    const row = await read(sql, ...p);
    if (!sql.includes('user_settings')) return row;
    const hold = armed;
    armed = null;
    if (hold) {
      hold.reached();
      await hold.release;
    }
    return row;
  }) as typeof db.getFirstAsync;
  const holdNext = () => {
    let open!: () => void;
    let reached!: () => void;
    const release = new Promise<void>((r) => (open = r));
    const got = new Promise<void>((r) => (reached = r));
    armed = { release, reached };
    return { open, reached: got };
  };
  const Wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider db={db}>{children}</SettingsProvider>;
  const r = await renderHook(() => useSettings(), { wrapper: Wrapper });
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  const rows = async () => ({
    settings: await db.getAllAsync('SELECT key FROM user_settings'),
    outbox: await db.getAllAsync('SELECT tbl FROM sync_outbox'),
  });
  return { db, r, holdNext, rows, failing };
}

describe('a settings save queued before sign-out or a wipe (#645)', () => {
  it('a save waiting behind a held one writes nothing after the sign-out wiped the store, and queues nothing', async () => {
    const { db, r, holdNext, rows } = await setup();
    const held = holdNext();
    await act(async () => r.result.current.setFocus(['chest'])); // A: inside its transaction, holding the write lock
    await held.reached;
    const told: boolean[] = [];
    await act(async () => r.result.current.update({ diet: 'veg' }, (stored) => told.push(stored))); // B: queued behind A, has not started
    const out = signOut(db, memoryTokens({ access: 'a', refresh: 'r' }), { discard: true }); // waits for the lock, then wipes
    await sleep(20);
    await act(async () => held.open());
    expect(await out).toBe(0);
    await sleep(50); // B runs now
    expect(await rows()).toEqual({ settings: [], outbox: [] });
    expect(await loadSettings(db)).toBeNull();
    expect(told).toEqual([false]); // the dropped save tells its caller that nothing was stored
    // The dropped save is not a failure: no error shows and nothing is kept for the account that is gone.
    expect(r.result.current.saveFailed).toBe(false);
    expect(await getKv(db, KEY_SETTINGS_KEPT)).toBeNull();
  });

  it('addCustomTags resolves false when its save is dropped by a sign-out, and true only for a save that was not dropped (#713)', async () => {
    const { db, r, holdNext } = await setup();
    const held = holdNext();
    await act(async () => r.result.current.setFocus(['chest'])); // inside its transaction, holding the write lock
    await held.reached;
    const tag = { pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: ['quads'], secondary: [], joints: [] };
    let ok: boolean | undefined;
    await act(async () => void r.result.current.addCustomTags('Mine', tag as never).then((v) => (ok = v))); // queued behind it
    const out = signOut(db, memoryTokens({ access: 'a', refresh: 'r' }), { discard: true });
    await sleep(20);
    await act(async () => held.open());
    expect(await out).toBe(0);
    await waitFor(() => expect(ok).toBeDefined());
    expect(ok).toBe(false); // accepted at first, but the save never landed: the caller must not add the exercise to the workout
    expect(await loadSettings(db)).toBeNull();
  });

  it('a save inside its transaction when the provider unmounts is not written', async () => {
    const { db, r, holdNext, rows } = await setup();
    const held = holdNext();
    await act(async () => r.result.current.setFocus(['chest'])); // its read is held
    await held.reached;
    await r.unmount();
    await act(async () => held.open());
    await sleep(50);
    expect((await loadSettings(db))!.focus).toEqual(['abs']); // the stored record is as before
    expect((await rows()).outbox).toEqual([]);
  });

  it('an edit made after the wipe by a provider started afterwards is saved as usual', async () => {
    const { db, holdNext } = await setup();
    holdNext().open();
    await signOut(db, memoryTokens({ access: 'a', refresh: 'r' }), { discard: true });
    const Wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider db={db}>{children}</SettingsProvider>;
    const next = await renderHook(() => useSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(next.result.current.ready).toBe(true));
    await act(async () => next.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
  });

  it('a save that fails while a sign-out waits for the lock keeps nothing for the old account, and the next account is untouched', async () => {
    const { db, r, holdNext, failing } = await setup();
    const held = holdNext();
    await act(async () => r.result.current.setDiet('veg')); // inside its transaction, holding the write lock
    await held.reached;
    const out = signOut(db, memoryTokens({ access: 'a', refresh: 'r' }), { discard: true }); // waits for the lock, then wipes
    await sleep(20);
    failing.on = true; // the write fails: rollback, then the wipe takes the lock before the failure handler can
    await act(async () => held.open());
    expect(await out).toBe(0);
    await sleep(50); // the failure handler's turn
    failing.on = false;
    expect(await getKv(db, KEY_SETTINGS_KEPT)).toBeNull();
    const Wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider db={db}>{children}</SettingsProvider>;
    const next = await renderHook(() => useSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(next.result.current.ready).toBe(true));
    await act(async () => next.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
    expect((await loadSettings(db))!.diet).toBe('any');
  });
});

describe('a wipe that does not commit (#645)', () => {
  it('does not count as a wipe: the mounted provider still saves', async () => {
    const { db, r } = await setup();
    const real = db.withExclusiveTransactionAsync.bind(db);
    db.withExclusiveTransactionAsync = (async (task) =>
      real(async (txn) => {
        await task(txn);
        throw new Error('COMMIT failed'); // rolls back what the wipe did
      })) as typeof db.withExclusiveTransactionAsync;
    await expect(wipeLocalStore(db, { force: true })).rejects.toThrow('COMMIT failed');
    db.withExclusiveTransactionAsync = real;
    expect(await loadSettings(db)).not.toBeNull(); // not wiped
    await act(async () => r.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
  });
});
