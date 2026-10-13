import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { loadSettings, saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { CUSTOM_EXERCISES_MAX } from '@plate-and-bar/core';
import { SettingsProvider, useSettings } from '../src/state/SettingsProvider';
import { getCatalog, setCustomTags } from '../src/workout/catalog';
import { memoryDb } from './helpers';

const wrap = (db: ReturnType<typeof memoryDb>) => {
  const Wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider db={db}>{children}</SettingsProvider>;
  return Wrapper;
};

describe('settings store', () => {
  it('round-trips the contract Settings shape, snake_case, id null with the natural key local', async () => {
    const db = memoryDb();
    expect(await loadSettings(db)).toBeNull();
    const s = { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['chest'], rest_off: true };
    await saveSettings(db, s);
    expect(await loadSettings(db)).toEqual(s);
    expect([...db.rows.keys()]).toEqual(['user_settings:me']);
    expect(Object.keys(s).sort()).toEqual(
      ['id', 'version', 'updated_at', 'deleted_at', 'focus', 'rest_off', 'custom_tags', 'diet', 'water_sizes', 'exercise_overrides', 'flex', 'returning', 'ladder_stay', 'checkin_seen', 'adjustments', 'adaptive', 'learn', 'meal_plan', 'prep'].sort(),
    );
    expect(s.id).toBeNull();
  });

  it('provider starts from defaults, writes nothing until a change, then keeps rows in the order of the changes', async () => {
    const db = memoryDb();
    db.lag = (sql) => (sql.includes('user_settings') ? 5 : 0);
    const { result } = await renderHook(() => useSettings(), { wrapper: wrap(db) });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.settings).toMatchObject({ focus: [], rest_off: false });
    expect(db.rows.size).toBe(0);
    await act(async () => {
      result.current.setFocus(['chest']);
      result.current.setRestOff(true);
      result.current.setFocus(['chest', 'lats']);
    });
    // visible at once, before the writes finish
    expect(result.current.settings).toMatchObject({ focus: ['chest', 'lats'], rest_off: true });
    await waitFor(async () => expect(await loadSettings(db)).toMatchObject({ focus: ['chest', 'lats'], rest_off: true }));
  });

  it('loads what is stored', async () => {
    const db = memoryDb();
    await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), focus: ['abs'] });
    const { result } = await renderHook(() => useSettings(), { wrapper: wrap(db) });
    await waitFor(() => expect(result.current.settings.focus).toEqual(['abs']));
  });

  it('drops stored flex entries that have no plan id instead of crashing', async () => {
    const db = memoryDb();
    const ok = { id: 'p1', date: '2026-10-09', kcal_delta: -200 };
    await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), flex: [{ date: '2026-10-08', kcal_delta: 200 } as never, ok] });
    expect((await loadSettings(db))?.flex).toEqual([ok]);
  });

  describe('custom exercises (#312)', () => {
    const tag = { pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary: ['quads'], secondary: [], joints: [] };
    afterEach(() => setCustomTags({}));

    it('custom tags stored on the device (or pulled) reach the catalog on load', async () => {
      const db = memoryDb();
      await saveSettings(db, { ...defaultSettings('2026-10-08T10:00:00Z'), custom_tags: { 'Pulled Lift': tag } });
      const { result } = await renderHook(() => useSettings(), { wrapper: wrap(db) });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(getCatalog().tags['Pulled Lift']).toEqual(tag);
    });

    it('a provider on an empty store (after a wipe) clears the previous user\'s custom exercises', async () => {
      const a = memoryDb();
      await saveSettings(a, { ...defaultSettings('2026-10-08T10:00:00Z'), custom_tags: { 'A Lift': tag } });
      const first = await renderHook(() => useSettings(), { wrapper: wrap(a) });
      await waitFor(() => expect(first.result.current.ready).toBe(true));
      expect(getCatalog().tags['A Lift']).toEqual(tag);
      const second = await renderHook(() => useSettings(), { wrapper: wrap(memoryDb()) });
      await waitFor(() => expect(second.result.current.ready).toBe(true));
      expect(getCatalog().tags['A Lift']).toBeUndefined();
    });

    it('a store that cannot be read leaves no custom exercises from the previous user', async () => {
      setCustomTags({ 'A Lift': tag });
      const db = memoryDb();
      db.rows.set('user_settings:me', '{not json');
      const { result } = await renderHook(() => useSettings(), { wrapper: wrap(db) });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.loadFailed).toBe(true);
      expect(getCatalog().tags['A Lift']).toBeUndefined();
    });

    it('addCustomTags saves and applies at once; at the contract limit a new name is refused, a known one replaced', async () => {
      const db = memoryDb();
      const { result } = await renderHook(() => useSettings(), { wrapper: wrap(db) });
      await waitFor(() => expect(result.current.ready).toBe(true));
      let ok = false;
      await act(async () => void (ok = result.current.addCustomTags('Mine', tag)));
      expect(ok).toBe(true);
      expect(getCatalog().tags.Mine).toEqual(tag);
      const full = Object.fromEntries(Array.from({ length: CUSTOM_EXERCISES_MAX }, (_, i) => [`E${i}`, tag]));
      await act(async () => void result.current.update({ custom_tags: full }));
      await act(async () => void (ok = result.current.addCustomTags('One too many', tag)));
      expect(ok).toBe(false);
      await act(async () => void (ok = result.current.addCustomTags('E0', { ...tag, primary: ['glutes'] })));
      expect(ok).toBe(true);
      await waitFor(async () => expect((await loadSettings(db))?.custom_tags.E0).toMatchObject({ primary: ['glutes'] }));
    });
  });
});

