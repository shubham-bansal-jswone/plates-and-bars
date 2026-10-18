import { loadDayNote, saveDayNote } from '../src/db/food';
import { loadStepsOn, saveStepsOn, syncDeviceSteps } from '../src/steps/store';
import type { DayNote } from '../src/food/types';
import { openDb } from './sync-helpers';

const D1 = '2026-10-08';
const D2 = '2026-10-09';
const STAMP = '2026-10-08T10:00:00Z';
const r = (counter: number, elapsedMs = 1_000_000) => async () => ({ counter, elapsedMs });
const note = (over: Partial<DayNote> = {}): DayNote => ({ id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: D1, complete: null, steps: null, sleep: null, fast: false, ...over });

describe('device steps store', () => {
  it('the toggle is off by default, turns on and off, and a change drops the baseline', async () => {
    const db = await openDb();
    expect(await loadStepsOn(db)).toBe(false);
    await saveStepsOn(db, true);
    expect(await loadStepsOn(db)).toBe(true);
    await syncDeviceSteps(db, r(1000), D1, STAMP);
    await saveStepsOn(db, false);
    expect(await loadStepsOn(db)).toBe(false);
    // counting starts again: the first reading after a change adds nothing
    await saveStepsOn(db, true);
    expect(await syncDeviceSteps(db, r(1500), D1, STAMP)).toBe(false);
    expect(await loadDayNote(db, D1)).toBeNull();
  });

  it('the first reading writes nothing; the next adds the delta as a device count', async () => {
    const db = await openDb();
    expect(await syncDeviceSteps(db, r(1000), D1, STAMP)).toBe(false);
    expect(await loadDayNote(db, D1)).toBeNull();
    expect(await syncDeviceSteps(db, r(1850), D1, STAMP)).toBe(true);
    expect(await loadDayNote(db, D1)).toMatchObject({ date: D1, steps: 850, steps_source: 'device', updated_at: STAMP });
    expect(await syncDeviceSteps(db, r(2000), D1, STAMP)).toBe(true);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 1000, steps_source: 'device' });
  });

  it('keeps the other fields of the day note and queues it for sync', async () => {
    const db = await openDb();
    await saveDayNote(db, note({ complete: true, fast: true, sleep: 7 }));
    await db.runAsync('DELETE FROM sync_outbox');
    await syncDeviceSteps(db, r(100), D1, STAMP);
    await syncDeviceSteps(db, r(400), D1, STAMP);
    expect(await loadDayNote(db, D1)).toMatchObject({ complete: true, fast: true, sleep: 7, steps: 300, steps_source: 'device', version: 1 });
    expect(await db.getAllAsync("SELECT tbl FROM sync_outbox WHERE tbl = 'day_notes'")).not.toHaveLength(0);
  });

  it('never overwrites steps the user typed, but the baseline keeps moving', async () => {
    const db = await openDb();
    await saveDayNote(db, note({ steps: 5000, steps_source: 'manual' }));
    await syncDeviceSteps(db, r(100), D1, STAMP);
    expect(await syncDeviceSteps(db, r(900), D1, STAMP)).toBe(false);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 5000, steps_source: 'manual' });
    // a typed entry with no source (older record) is manual too
    await saveDayNote(db, note({ steps: 7, version: 2 }));
    expect(await syncDeviceSteps(db, r(1000), D1, STAMP)).toBe(false);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 7 });
  });

  it('writes again once the typed steps are cleared', async () => {
    const db = await openDb();
    await saveDayNote(db, note({ steps: 5000, steps_source: 'manual' }));
    await syncDeviceSteps(db, r(100), D1, STAMP);
    await syncDeviceSteps(db, r(900), D1, STAMP);
    await saveDayNote(db, note({ steps: null, steps_source: null, version: 2 }));
    expect(await syncDeviceSteps(db, r(1000), D1, STAMP)).toBe(true);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 900, steps_source: 'device' });
  });

  it('does not lower a higher device count already on the note', async () => {
    const db = await openDb();
    await saveDayNote(db, note({ steps: 9000, steps_source: 'device' }));
    await syncDeviceSteps(db, r(100), D1, STAMP);
    expect(await syncDeviceSteps(db, r(500), D1, STAMP)).toBe(false);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 9000 });
  });

  it('after a reboot counts the new counter value', async () => {
    const db = await openDb();
    await syncDeviceSteps(db, r(50000, 5_000_000), D1, STAMP);
    await syncDeviceSteps(db, r(50100, 6_000_000), D1, STAMP);
    await syncDeviceSteps(db, r(250, 100_000), D1, STAMP);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 350 });
  });

  it('across one midnight the gap goes to the old day and the new day starts at 0', async () => {
    const db = await openDb();
    await syncDeviceSteps(db, r(1000), D1, STAMP);
    expect(await syncDeviceSteps(db, r(1600), D2, STAMP)).toBe(true);
    expect(await loadDayNote(db, D1)).toMatchObject({ steps: 600, steps_source: 'device' });
    expect(await loadDayNote(db, D2)).toBeNull();
    await syncDeviceSteps(db, r(1700), D2, STAMP);
    expect(await loadDayNote(db, D2)).toMatchObject({ steps: 100, steps_source: 'device' });
  });

  it('writes nothing when there is no reading (no sensor, no permission)', async () => {
    const db = await openDb();
    expect(await syncDeviceSteps(db, async () => null, D1, STAMP)).toBe(false);
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).toBeNull();
  });

  it('a damaged baseline reads as none', async () => {
    const db = await openDb();
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('steps.device.baseline', ?)", '{"date":"x"');
    expect(await syncDeviceSteps(db, r(500), D1, STAMP)).toBe(false);
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES ('steps.device.baseline', ?)", JSON.stringify({ date: D1, steps: 'a', counter: 1, elapsedMs: 1 }));
    expect(await syncDeviceSteps(db, r(600), D1, STAMP)).toBe(false);
    expect(await syncDeviceSteps(db, r(700), D1, STAMP)).toBe(true);
  });
});
