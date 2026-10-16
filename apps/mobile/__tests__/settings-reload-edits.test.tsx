import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createClient } from '@plate-and-bar/api';
import type { ReactNode } from 'react';
import { applyPulled, isQueued } from '../src/db/outbox';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { syncOnce } from '../src/sync/engine';
import { setKv, KEY_USER } from '../src/sync/store';
import { fakeServer, memoryTokens, openDb, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

const PULLED_VERSION = 7; // the server's version of the record: a save must keep it, or the upload is a conflict
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
  // Writes of the settings record: the next one can be held, and all of them can be made to fail.
  let heldWrite: Promise<void> | null = null;
  const writes = { failing: false };
  const run = db.runAsync.bind(db);
  db.runAsync = (async (sql: string, ...p: (string | number)[]) => {
    if (sql.includes('user_settings')) {
      if (heldWrite) {
        const h = heldWrite;
        heldWrite = null;
        await h;
      }
      if (writes.failing) throw new Error('disk full');
    }
    return run(sql, ...p);
  }) as typeof db.runAsync;
  const holdWrite = () => {
    let open!: () => void;
    heldWrite = new Promise<void>((r) => (open = r));
    return open;
  };
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
  const seen: Settings[] = []; // every settings value a render showed
  const { result, rerender } = await renderHook(
    () => {
      const v = useSettings();
      seen.push(v.settings);
      return v;
    },
    { wrapper: Wrapper },
  );
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
  return { db, result, reload, holdNext, holdWrite, writes, reads, upload, pull, pullOnce, seen };
}

/**
 * Another device changed `rest_off`: a pull stores the record (without queuing it), as the sync engine does.
 * Resolves true when it was applied, false when the record had a local change waiting. `hold` keeps the pull's transaction open.
 */
function pullFromOtherDevice(db: Awaited<ReturnType<typeof openDb>>) {
  return async (hold?: { inside: () => void; until: Promise<void> }): Promise<boolean> => {
    const cur = (await loadSettings(db))!;
    return applyPulled(db, 'settings', 'me', async (txn) => {
      hold?.inside();
      await hold?.until;
      await saveSettings(txn, { ...cur, version: PULLED_VERSION, rest_off: true, updated_at: '2026-10-09T09:00:00Z' });
    });
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const inc = (s: Settings) => ({ adjustments: { ...s.adjustments, n: ((s.adjustments.n as number | undefined) ?? 0) + 1 } });
const count = (s: Settings) => s.adjustments.n;

describe('settings reload with an edit while it reads (#614)', () => {
  it('applies the edit on the pulled record: a field another device changed is kept, in memory, stored and uploaded, with the pulled version', async () => {
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
    const want = { focus: ['chest'], rest_off: true, version: PULLED_VERSION };
    expect(result.current.settings).toMatchObject(want);
    expect(await loadSettings(db)).toMatchObject(want);
    expect(await upload()).toMatchObject(want); // the server's version, so it accepts the upload instead of logging a conflict
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
    const all = { focus: ['chest'], diet: 'veg', water_sizes: { glass_ml: 123, bottle_ml: 456 }, rest_off: true, version: PULLED_VERSION };
    await waitFor(() => expect(result.current.settings).toMatchObject(all));
    await new Promise((r) => setTimeout(r, 60));
    // Exactly three reads by the reload (first, re-read, final: the loop stopped) and one by each of the three saves.
    expect(reads.n).toBe(6);
    expect(result.current.settings).toMatchObject(all);
    expect(await loadSettings(db)).toMatchObject(all);
    expect(await upload()).toMatchObject(all);
  });

  it('keeps the pulled field when the edit lands after the pull stored it but before the reload starts', async () => {
    const { db, result, reload, pull, upload } = await setup();
    await pull(); // the rest of the sync run still has to finish before the app reloads
    await act(async () => {
      result.current.setFocus(['chest']);
    });
    await waitFor(() => expect(result.current.settings.rest_off).toBe(true)); // what the save stored is what shows, even before any reload
    await reload();
    await new Promise((r) => setTimeout(r, 30));
    const want = { focus: ['chest'], rest_off: true, version: PULLED_VERSION };
    expect(result.current.settings).toMatchObject(want);
    expect(await loadSettings(db)).toMatchObject(want);
    expect(await upload()).toMatchObject(want);
  });

  it('applies a function edit once: one queued outside a reload, then a reload, then another during it', async () => {
    const { db, result, reload, holdWrite } = await setup();
    const open = holdWrite();
    await act(async () => {
      result.current.setDiet('veg'); // its write is held
    });
    await act(async () => {
      result.current.update(inc); // outside a reload, queued behind the held write
    });
    await reload(); // the reload starts and waits for the queue
    await act(async () => {
      result.current.update(inc); // during the reload
    });
    await act(async () => open());
    await new Promise((r) => setTimeout(r, 30));
    expect(count((await loadSettings(db))!)).toBe(2);
    expect(count(result.current.settings)).toBe(2);
  });
});

describe('settings saves outside a reload', () => {
  it('save as before: each edit is stored in order, with the stored version and fields kept, and memory matches', async () => {
    const { db, result } = await setup();
    const before = (await loadSettings(db))!;
    await act(async () => {
      result.current.setFocus(['chest']);
      result.current.update(inc);
      result.current.update(inc);
      result.current.setDiet('veg');
    });
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'], diet: 'veg' }));
    expect(count((await loadSettings(db))!)).toBe(2);
    expect(await loadSettings(db)).toMatchObject({ version: before.version, rest_off: false, water_sizes: before.water_sizes });
    expect(result.current.settings).toMatchObject({ focus: ['chest'], diet: 'veg', adjustments: { n: 2 } });
    expect(result.current.saveFailed).toBe(false);
  });

  it('saves into an empty store from the defaults plus the edit, once', async () => {
    const { db, result } = await setup();
    await db.runAsync('DELETE FROM user_settings');
    await act(async () => {
      result.current.update(inc);
    });
    await waitFor(async () => expect(await loadSettings(db)).not.toBeNull());
    expect(await loadSettings(db)).toMatchObject({ focus: [], adjustments: { n: 1 } });
  });
});

describe('a failed settings write (#614)', () => {
  it('is kept and applied once with the next successful save, not dropped and not applied twice', async () => {
    const { db, result, writes, pull, upload } = await setup();
    await pull();
    writes.failing = true;
    await act(async () => {
      result.current.update(inc);
    });
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(count((await loadSettings(db))!)).toBeUndefined(); // not stored
    expect(count(result.current.settings)).toBe(1); // still shown
    writes.failing = false;
    await act(async () => {
      result.current.update(inc);
    });
    await waitFor(() => expect(result.current.saveFailed).toBe(false));
    expect(count((await loadSettings(db))!)).toBe(2); // the failed edit once, the new one once
    await act(async () => {
      result.current.setDiet('veg');
    });
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ diet: 'veg' }));
    const stored = (await loadSettings(db))!;
    expect(count(stored)).toBe(2); // a saved edit is not applied again
    expect(stored).toMatchObject({ rest_off: true, version: PULLED_VERSION });
    expect(count(result.current.settings)).toBe(2);
    expect(count((await upload()) as Settings)).toBe(2);
  });
});

describe('a pull and a settings save at the same time (#614)', () => {
  it('the pull first: the save reads the pulled record, so the result has the pulled fields, the pulled version and the edit', async () => {
    const { db, result, pullOnce, upload } = await setup();
    let inside!: () => void;
    const started = new Promise<void>((r) => (inside = r));
    let open!: () => void;
    const until = new Promise<void>((r) => (open = r));
    const pulling = pullOnce({ inside, until }); // the pull's transaction is open and holds the write lock
    await started;
    await act(async () => {
      result.current.setFocus(['chest']); // the save has to wait for it
    });
    await sleep(20);
    open();
    expect(await pulling).toBe(true);
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
    const want = { focus: ['chest'], rest_off: true, version: PULLED_VERSION };
    expect(await loadSettings(db)).toMatchObject(want);
    await waitFor(() => expect(result.current.settings).toMatchObject(want));
    expect(await upload()).toMatchObject(want);
  });

  it('the save first: the pull waits for it, then finds the edit queued and leaves the record, so the stored record is never half of each', async () => {
    const { db, result, holdNext, pullOnce } = await setup();
    const held = holdNext();
    await act(async () => {
      result.current.setFocus(['chest']);
    });
    await held.reached; // the save has read the record and is inside its transaction
    const pulling = pullOnce(); // the other device's record arrives now
    await sleep(20);
    expect(await loadSettings(db)).toMatchObject({ rest_off: false }); // the pull has not stored anything while the save is open
    await act(async () => held.open());
    expect(await pulling).toBe(false); // it found the save queued: the next push settles the two
    expect(await loadSettings(db)).toMatchObject({ focus: ['chest'], rest_off: false, version: 0 });
    expect(await isQueued(db, 'settings', 'me')).toBe(true);
  });
});

describe('after a failed settings write (#614)', () => {
  it('a reload keeps showing the failed edit on top of the reloaded record, and the next save stores it', async () => {
    const { db, result, reload, writes, pull } = await setup();
    await pull(); // another device's change is in the store as well
    writes.failing = true;
    await act(async () => {
      result.current.setDiet('veg');
    });
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    writes.failing = false;
    await reload();
    await sleep(30);
    expect(result.current.settings).toMatchObject({ diet: 'veg', rest_off: true }); // the edit is not dropped from the screen
    expect((await loadSettings(db))!.diet).not.toBe('veg'); // and it is not stored yet
    await act(async () => {
      result.current.setFocus(['chest']); // an unrelated edit: the kept one is saved with it, as shown
    });
    await waitFor(() => expect(result.current.saveFailed).toBe(false));
    await sleep(20);
    expect(await loadSettings(db)).toMatchObject({ diet: 'veg', focus: ['chest'], rest_off: true, version: PULLED_VERSION });
    expect(result.current.settings).toMatchObject({ diet: 'veg', focus: ['chest'], rest_off: true });
  });
});

describe('what shows while edits are still being saved (#614)', () => {
  it('a landed save does not take a newer queued edit off the screen', async () => {
    const { result, holdWrite, holdNext } = await setup();
    const openWrite = holdWrite();
    await act(async () => {
      result.current.setFocus(['chest']); // A: its write is held
    });
    await sleep(10);
    const readB = holdNext(); // B's read will be held
    await act(async () => {
      result.current.setDiet('veg'); // B: queued behind A
    });
    await act(async () => openWrite()); // A lands, and B starts reading
    await readB.reached;
    await sleep(10);
    expect(result.current.settings).toMatchObject({ focus: ['chest'], diet: 'veg' }); // B still shows
    await act(async () => readB.open());
    await waitFor(() => expect(result.current.settings).toMatchObject({ focus: ['chest'], diet: 'veg' }));
  });

  it('no render between the edits and their saves shows a state without a newer edit', async () => {
    const { result, holdWrite, seen } = await setup();
    const open = holdWrite();
    await act(async () => {
      result.current.setFocus(['chest']);
    });
    await act(async () => {
      result.current.setDiet('veg');
    });
    const from = seen.length;
    await act(async () => open());
    await act(async () => {
      result.current.setRestOff(true);
    });
    await sleep(30);
    expect(seen.slice(from).filter((s) => s.diet !== 'veg' || s.focus[0] !== 'chest')).toHaveLength(0);
    expect(result.current.settings).toMatchObject({ focus: ['chest'], diet: 'veg', rest_off: true });
  });
});
