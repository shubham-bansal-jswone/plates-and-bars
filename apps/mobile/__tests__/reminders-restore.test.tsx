import { render, waitFor } from '@testing-library/react-native';
import { saveProfile } from '../src/db/records';
import { DEFAULT_PREFS } from '../src/reminders/schedule';
import { saveReminderPrefs } from '../src/reminders/store';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { Stores } from '../src/sync/Stores';
import { openDb } from './sync-helpers';

const mockNative = { getPermissionStatus: jest.fn(), requestPermission: jest.fn(), setRules: jest.fn(), cancelAll: jest.fn() };
jest.mock('../src/reminders/native', () => ({ __esModule: true, get default() { return mockNative; } }));
const mockSync = { epoch: 0, dataVersion: 0 };
jest.mock('../src/sync/SyncProvider', () => ({ useSync: () => mockSync }));
jest.mock('expo-crypto', () => require('./sync-crypto-mock')); // eslint-disable-line @typescript-eslint/no-require-imports

const profile = (days: 3 | 4) =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 9, 1));
const calls = () => mockNative.setRules.mock.calls.map((c) => c[0] as { id: string; days: number[] }[]);

beforeEach(() => {
  jest.clearAllMocks();
  mockSync.epoch = 0;
  mockSync.dataVersion = 0;
  mockNative.setRules.mockResolvedValue(undefined);
});

describe('reminders are restored without opening the Targets tab', () => {
  it('sets the saved schedule at app start, with the training days of the stored plan', async () => {
    const db = await openDb();
    await saveProfile(db, profile(3));
    await saveReminderPrefs(db, { ...DEFAULT_PREFS, weigh_in: { on: true, time: '07:30' }, workout: { on: true, time: '17:30' } });
    await render(<Stores db={db as never}>{null}</Stores>);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    // Never the 6-day plan of "no profile yet": the plan is read before the schedule is set.
    for (const c of calls()) expect(c.find((r) => r.id === 'workout')!.days).toEqual([1, 3, 5]);
    expect(calls().at(-1)!.map((r) => r.id)).toEqual(['weigh_in', 'workout']);
  });

  it('follows a plan whose days changed through a pull from another device', async () => {
    const db = await openDb();
    await saveProfile(db, profile(3));
    await saveReminderPrefs(db, { ...DEFAULT_PREFS, workout: { on: true, time: '17:30' } });
    const r = await render(<Stores db={db as never}>{null}</Stores>);
    await waitFor(() => expect(calls().at(-1)?.[0]?.days).toEqual([1, 3, 5]));
    await saveProfile(db, profile(4)); // what a pull stores
    mockSync.dataVersion = 1;
    await r.rerender(<Stores db={db as never}>{null}</Stores>);
    await waitFor(() => expect(calls().at(-1)?.[0]?.days).toEqual([1, 2, 4, 5]));
  });

  it('with nothing saved it schedules nothing (an empty set, which also clears alarms left from before)', async () => {
    const db = await openDb();
    await saveProfile(db, profile(3));
    await render(<Stores db={db as never}>{null}</Stores>);
    await waitFor(() => expect(calls().length).toBeGreaterThan(0));
    expect(calls().every((c) => c.length === 0)).toBe(true);
  });
});
