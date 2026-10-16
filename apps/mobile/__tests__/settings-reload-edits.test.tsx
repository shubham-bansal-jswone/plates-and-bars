import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import type { ReactNode } from 'react';
import { applyPulled } from '../src/db/outbox';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { syncOnce } from '../src/sync/engine';
import { setKv, KEY_USER } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** A real SQLite whose reads of the settings record can be held: a read returns what it read, but only after `release`. */
async function setup() {
  const db = await openDb();
  await setKv(db, KEY_USER, USER);
  await seedConsent(db);
  const local = { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['abs'] };
  await saveSettings(db, local);
  await db.runAsync('DELETE FROM sync_outbox');
  let armed: { release: Promise<void>; reached: () => void } | null = null;
  const reads = { n: 0 };
  const read = db.getFirstAsync.bind(db);
  db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
    const row = await read(sql, ...p);
    if (!sql.includes('user_settings')) return row;
    reads.n += 1;
    const hold = armed;
    armed = null; // only the next read is held
    if (hold) {
      hold.reached();
      await hold.release;
    }
    return row;
  }) as typeof db.getFirstAsync;
  /** Holds the next read of the settings record; `reached` resolves when a read is held, `open` lets it return. */
  const holdNext = () => {
    let open!: () => void;
    let reached!: () => void;
    const release = new Promise<void>((r) => (open = r));
    const got = new Promise<void>((r) => (reached = r));
    armed = { release, reached };
    return { open, reached: got };
  };
  let key = 0;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsProvider db={db} reloadKey={key}>
      {children}
    </SettingsProvider>
  );
  const { result, rerender } = await renderHook(() => useSettings(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  reads.n = 0; // the first load is done: count the reloads from here
  const reload = async () => {
    key += 1;
    await rerender(undefined);
  };
  /** What the next push would send for the settings record. */
  const upload = async () => {
    const server = fakeServer(USER);
    (globalThis as { fetch: unknown }).fetch = server.fetch;
    const api = createClient('http://fake/api/v1', async () => 'access-1');
    await syncOnce({ db, api, tokens: memoryTokens({ access: 'access-1', refresh: 'refresh-1' }) });
    return server.pushed().find((r) => r.table === 'settings') as unknown as Settings | undefined;
  };
  const pullOnce = pullFromOtherDevice(db);
  const pull = async () => {
    await pullOnce();
    reads.n = 0; // only the provider's reads are counted
  };
  return { db, result, reload, holdNext, reads, upload, pull };
}

/** Another device changed `rest_off`: a pull stores the record (without queuing it), as the sync engine does. */
function pullFromOtherDevice(db: Awaited<ReturnType<typeof openDb>>) {
  return async () => {
    const cur = (await loadSettings(db))!;
    await applyPulled(db, 'settings', 'me', (txn) => saveSettings(txn, { ...cur, rest_off: true, updated_at: '2026-10-09T09:00:00Z' }));
  };
}

describe('settings reload with an edit while it reads (#614)', () => {
  it('applies the edit on the pulled record: a field another device changed is kept, in memory, stored and uploaded', async () => {
    const { db, result, reload, holdNext, pull, upload } = await setup();
    await pull();
    const first = holdNext();
    await reload(); // the reload reads the pulled record (rest_off true) and is held
    await first.reached;
    await act(async () => {
      result.current.setFocus(['chest']); // the user edits while it reads; the in-memory copy still has rest_off false
    });
    await act(async () => first.open());
    await waitFor(() => expect(result.current.settings).toMatchObject({ focus: ['chest'], rest_off: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.settings).toMatchObject({ focus: ['chest'], rest_off: true });
    expect(await loadSettings(db)).toMatchObject({ focus: ['chest'], rest_off: true });
    expect(await upload()).toMatchObject({ focus: ['chest'], rest_off: true });
  });

  it('keeps all three of one edit during the first read and two during the re-read, and stops reading', async () => {
    const { db, result, reload, holdNext, reads, pull, upload } = await setup();
    await pull();
    const first = holdNext();
    await reload();
    await first.reached;
    await act(async () => {
      result.current.setFocus(['chest']); // during the first read
    });
    const second = holdNext(); // the next read is the reload's second one
    await act(async () => first.open());
    await second.reached;
    await act(async () => {
      result.current.setDiet('veg'); // two more during the re-read
      result.current.update({ water_sizes: { glass_ml: 123, bottle_ml: 456 } });
    });
    await act(async () => second.open());
    const all = { focus: ['chest'], diet: 'veg', water_sizes: { glass_ml: 123, bottle_ml: 456 }, rest_off: true };
    await waitFor(() => expect(result.current.settings).toMatchObject(all));
    await new Promise((r) => setTimeout(r, 30));
    const settled = reads.n;
    await new Promise((r) => setTimeout(r, 30));
    expect(reads.n).toBe(settled); // the loop stopped: no further read
    expect(result.current.settings).toMatchObject(all);
    expect(await loadSettings(db)).toMatchObject(all);
    expect(await upload()).toMatchObject(all);
  });
});
