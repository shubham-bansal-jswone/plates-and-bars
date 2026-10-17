import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { applyPulled } from '../src/db/outbox';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { wipeLocalStore } from '../src/sync/guard';
import { readKept } from '../src/state/keptEdits';
import { getKv, KEY_SETTINGS_KEPT, setKv } from '../src/sync/store';
import { openDb } from './sync-helpers';

const PULLED_VERSION = 7;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real SQLite whose writes of the settings record can be made to fail. */
async function setup() {
  const db = await openDb();
  await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['abs'] });
  await db.runAsync('DELETE FROM sync_outbox');
  const writes = { failing: false };
  const run = db.runAsync.bind(db);
  db.runAsync = (async (sql: string, ...p: (string | number)[]) => {
    if (sql.includes('user_settings') && writes.failing) throw new Error('disk full');
    return run(sql, ...p);
  }) as typeof db.runAsync;
  let key = 0;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsProvider db={db} reloadKey={key}>
      {children}
    </SettingsProvider>
  );
  /** Starts the provider, as an app launch does. */
  const launch = async () => {
    const r = await renderHook(() => useSettings(), { wrapper: Wrapper });
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    return r;
  };
  const reload = async (r: Awaited<ReturnType<typeof launch>>) => {
    key += 1;
    await r.rerender(undefined);
    await sleep(30);
  };
  /** Another device changed these fields: a pull stores the record without queuing it. */
  const pull = async (change: Partial<Settings>) => {
    const cur = (await loadSettings(db))!;
    const ok = await applyPulled(db, 'settings', 'me', async (txn) => saveSettings(txn, { ...cur, ...change, version: PULLED_VERSION, updated_at: '2026-10-09T09:00:00Z' }));
    expect(ok).toBe(true);
  };
  return { db, writes, launch, reload, pull };
}

const inc = (s: Settings) => ({ adjustments: { ...s.adjustments, n: ((s.adjustments.n as number | undefined) ?? 0) + 1 } });
const count = (s: Settings) => s.adjustments.n;

describe('a kept settings edit and a pull of the same field (#651)', () => {
  it('failed setDiet(veg), a pull stores egg, reload, next save: the newer remote value wins, the edit is gone', async () => {
    const { db, writes, launch, reload, pull } = await setup();
    const r = await launch();
    writes.failing = true;
    await act(async () => r.result.current.setDiet('veg'));
    await waitFor(() => expect(r.result.current.saveFailed).toBe(true));
    writes.failing = false;
    await pull({ diet: 'egg' });
    await reload(r);
    expect(r.result.current.settings.diet).toBe('egg'); // the screen shows the remote value too
    await act(async () => r.result.current.setFocus(['chest'])); // the next save
    await waitFor(() => expect(r.result.current.saveFailed).toBe(false));
    await sleep(20);
    expect(await loadSettings(db)).toMatchObject({ diet: 'egg', focus: ['chest'], version: PULLED_VERSION });
    expect(r.result.current.settings).toMatchObject({ diet: 'egg', focus: ['chest'] });
  });

  it('a pull that stores an object field with its keys in another order does not drop the kept edit of that field', async () => {
    const { db, writes, launch, pull } = await setup();
    await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['abs'], adjustments: { zz: 1, a: 1 } });
    await db.runAsync('DELETE FROM sync_outbox');
    const r = await launch();
    writes.failing = true;
    await act(async () => r.result.current.update(inc));
    await waitFor(() => expect(r.result.current.saveFailed).toBe(true));
    writes.failing = false;
    await pull({ diet: 'egg', adjustments: { a: 1, zz: 1 } }); // the server's JSON column returns the keys in its own order
    await act(async () => r.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
    expect(await loadSettings(db)).toMatchObject({ diet: 'egg', adjustments: { a: 1, zz: 1, n: 1 } });
  });

  it('a kept edit for another field still applies when a pull changed a different one', async () => {
    const { db, writes, launch, pull } = await setup();
    const r = await launch();
    writes.failing = true;
    await act(async () => {
      r.result.current.setDiet('veg');
      r.result.current.setFocus(['chest']);
    });
    await waitFor(() => expect(r.result.current.saveFailed).toBe(true));
    writes.failing = false;
    await pull({ diet: 'egg' });
    await act(async () => r.result.current.setRestOff(true));
    await waitFor(() => expect(r.result.current.saveFailed).toBe(false));
    await sleep(20);
    expect(await loadSettings(db)).toMatchObject({ diet: 'egg', focus: ['chest'], rest_off: true });
  });
});

describe('kept settings edits survive an app restart (#651)', () => {
  it('an edit for an unrelated field is applied once by the next save after a restart, and the stored copy is cleared', async () => {
    const { db, writes, launch, pull } = await setup();
    const first = await launch();
    writes.failing = true;
    await act(async () => first.result.current.update(inc));
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true));
    expect(await getKv(db, KEY_SETTINGS_KEPT)).not.toBeNull();
    writes.failing = false;
    await first.unmount(); // the app closes with the edit unsaved
    await pull({ diet: 'egg' }); // and another device changes something else meanwhile
    const second = await launch(); // restart
    expect(count(second.result.current.settings)).toBe(1); // still shown
    await act(async () => second.result.current.update(inc));
    await waitFor(async () => expect(count((await loadSettings(db))!)).toBe(2)); // the kept one once, the new one once
    await act(async () => second.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
    expect(count((await loadSettings(db))!)).toBe(2); // not applied again
    expect(await loadSettings(db)).toMatchObject({ diet: 'egg', version: PULLED_VERSION });
    expect(await getKv(db, KEY_SETTINGS_KEPT)).toBeNull();
  });

  it('two failed edits of the same field both survive a restart', async () => {
    const { db, writes, launch } = await setup();
    const first = await launch();
    writes.failing = true;
    await act(async () => first.result.current.update(inc));
    await act(async () => first.result.current.update(inc));
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true));
    await sleep(30);
    writes.failing = false;
    await first.unmount();
    const second = await launch();
    await act(async () => second.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
    expect(count((await loadSettings(db))!)).toBe(2); // the second edit builds on the first, not on the stored base
  });

  it('a restart drops the kept edit for a field a pull changed while the app was closed', async () => {
    const { db, writes, launch, pull } = await setup();
    const first = await launch();
    writes.failing = true;
    await act(async () => first.result.current.setDiet('veg'));
    await waitFor(() => expect(first.result.current.saveFailed).toBe(true));
    writes.failing = false;
    await first.unmount();
    await pull({ diet: 'egg' });
    const second = await launch();
    await act(async () => second.result.current.setFocus(['chest']));
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest'] }));
    expect((await loadSettings(db))!.diet).toBe('egg');
  });

  it('a reload that drops a kept field rewrites the saved copy too, so a restart does not read it again', async () => {
    const { db, writes, launch, reload, pull } = await setup();
    const r = await launch();
    writes.failing = true;
    await act(async () => r.result.current.setDiet('veg'));
    await waitFor(() => expect(r.result.current.saveFailed).toBe(true));
    await sleep(20);
    const saved = async () => JSON.parse((await getKv(db, KEY_SETTINGS_KEPT)) as string).edits.map((e: { value: Record<string, unknown> }) => Object.keys(e.value));
    expect(await saved()).toEqual([['diet']]);
    writes.failing = false;
    await pull({ diet: 'egg' });
    await reload(r); // the pulled diet wins: the kept edit has nothing left for that field
    expect(r.result.current.settings.diet).toBe('egg');
    expect(await saved()).toEqual([[]]);
  });

  it('a saved copy of another version, an old list, or edits with array fields read as none', async () => {
    const { db } = await setup();
    const edit = { at: '2026-10-08T10:00:00Z', base: { diet: 'any' }, value: { diet: 'veg' } };
    const read = async (saved: unknown) => {
      await setKv(db, KEY_SETTINGS_KEPT, JSON.stringify(saved));
      return readKept(db);
    };
    expect(await read({ v: 1, edits: [edit] })).toEqual([edit]);
    expect(await read([edit])).toEqual([]); // the format before it had a version
    expect(await read({ v: 2, edits: [edit] })).toEqual([]);
    expect(await read({ v: 1, edits: [{ ...edit, base: ['diet'] }, { ...edit, value: [] }] })).toEqual([]);
    expect(await read({ v: 1, edits: 'x' })).toEqual([]);
  });

  it('a store wipe removes the kept edits', async () => {
    const { db, writes, launch } = await setup();
    const r = await launch();
    writes.failing = true;
    await act(async () => r.result.current.setDiet('veg'));
    await waitFor(() => expect(r.result.current.saveFailed).toBe(true));
    expect(await getKv(db, KEY_SETTINGS_KEPT)).not.toBeNull();
    writes.failing = false;
    await wipeLocalStore(db, { force: true });
    expect(await getKv(db, KEY_SETTINGS_KEPT)).toBeNull();
  });
});
