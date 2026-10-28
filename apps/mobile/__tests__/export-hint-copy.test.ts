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

  it('the export builder really includes lab reports, the lab hold and kitchen tests, and no photo fields', async () => {
    const db = await openDb();
    await saveReport(db, { id: 'r1', date: '2026-10-01', tests: [{ name: 'Glucose', value: '90', unit: 'mg/dL', low: '70', high: '100' }] });
    await saveHold(db, { on: true, since: '2026-10-01' });
    const { file } = await buildLocalExport(db);
    expect(file.device_only.labs?.reports).toHaveLength(1);
    expect(file.device_only.labs?.hold).toEqual({ on: true, since: '2026-10-01' });
    expect(Object.keys(file.tables)).toContain('kitchen_tests');
    expect(Object.keys(SYNC_TABLES)).toContain('kitchen_tests');
    expect(JSON.stringify(file)).not.toMatch(/photo/i);
  });
});
