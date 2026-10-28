/** @jest-environment node */
import { DATA_COPY } from '../src/account/copy';
import { buildLocalExport } from '../src/account/exportLocal';
import { saveHold, saveReport } from '../src/db/labs';
import { SYNC_TABLES } from '../src/db/outbox';
import { openDb } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));

describe('the Data screen export hint matches what the device download holds (#1286)', () => {
  it('says lab reports and the cycle log are included and photos are not', () => {
    const [included, excluded] = DATA_COPY.exportHint.split(/Photos/);
    expect(included).toMatch(/lab reports/i);
    expect(included).toMatch(/cycle log/i);
    expect(included).toMatch(/kitchen tests/i);
    expect(DATA_COPY.exportHint).toMatch(/Photos \(progress and kitchen test\) are not in it/);
    expect(excluded).not.toMatch(/lab/i);
    expect(DATA_COPY.exportHint).not.toMatch(/lab data are not/i);
  });

  it('the export builder really includes lab reports, the lab hold and kitchen tests with only a has_photo flag, no picture', async () => {
    const db = await openDb();
    await saveReport(db, { id: 'r1', date: '2026-10-01', tests: [{ name: 'Glucose', value: '90', unit: 'mg/dL', low: '70', high: '100' }] });
    await saveHold(db, { on: true, since: '2026-10-01' });
    const kt = { id: 'k1', version: 1, updated_at: '2026-10-01T06:00:00.000Z', deleted_at: null, name: 'Dal', date: '2026-10-01', note: '', ingredients: [], pot_g: 500, pot_full_g: 1500, cooked_g: 1000, serving_g: 250, serving_name: 'bowl', has_photo: true };
    await db.runAsync('INSERT INTO kitchen_tests (key, data) VALUES (?, ?)', 'k1', JSON.stringify(kt));
    const { file } = await buildLocalExport(db);
    expect(file.device_only.labs?.reports).toHaveLength(1);
    expect(file.device_only.labs?.hold).toEqual({ on: true, since: '2026-10-01' });
    expect(Object.keys(SYNC_TABLES)).toContain('kitchen_tests');
    // The record carries only the contract's has_photo flag, never the picture itself.
    expect(file.tables.kitchen_tests).toEqual([kt]);
    const strings: string[] = [];
    JSON.stringify(file, (_k, v: unknown) => (typeof v === 'string' && strings.push(v), v));
    expect(strings.filter((v) => /^data:|^file:|base64|\.(jpe?g|png|webp|heic)$/i.test(v))).toEqual([]);
  });
});
