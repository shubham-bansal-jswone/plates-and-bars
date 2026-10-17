import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { signOut } from '../src/sync/guard';
import { KEY_USER, setKv } from '../src/sync/store';
import { memoryTokens, openDb } from './sync-helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real SQLite where the next read of the settings record can be held (the save is then inside its transaction). */
async function setup() {
  const db = await openDb();
  await setKv(db, KEY_USER, 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
  await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['abs'] });
  await db.runAsync('DELETE FROM sync_outbox');
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
  return { db, r, holdNext, rows };
}

describe('a settings save queued before sign-out or a wipe (#645)', () => {
  it('a save waiting behind a held one writes nothing after the sign-out wiped the store, and queues nothing', async () => {
    const { db, r, holdNext, rows } = await setup();
    const held = holdNext();
    await act(async () => r.result.current.setFocus(['chest'])); // A: inside its transaction, holding the write lock
    await held.reached;
    await act(async () => r.result.current.setDiet('veg')); // B: queued behind A, has not started
    const out = signOut(db, memoryTokens({ access: 'a', refresh: 'r' }), { discard: true }); // waits for the lock, then wipes
    await sleep(20);
    await act(async () => held.open());
    expect(await out).toBe(0);
    await sleep(50); // B runs now
    expect(await rows()).toEqual({ settings: [], outbox: [] });
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
});
