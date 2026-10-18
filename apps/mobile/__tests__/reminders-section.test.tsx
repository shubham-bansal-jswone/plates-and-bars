import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { RemindersSection } from '../src/reminders/RemindersSection';
import { loadReminderPrefs } from '../src/reminders/store';
import { wipeLocalStore } from '../src/sync/guard';
import { KEY_REMINDERS, getKv } from '../src/sync/store';
import { openDb, turns } from './sync-helpers';

const mockNative = { getPermissionStatus: jest.fn(), requestPermission: jest.fn(), setRules: jest.fn(), cancelAll: jest.fn() };
let mockModule: typeof mockNative | null = mockNative;
jest.mock('../src/reminders/native', () => ({ __esModule: true, get default() { return mockModule; } }));
jest.mock('expo-crypto', () => require('./sync-crypto-mock')); // eslint-disable-line @typescript-eslint/no-require-imports

const lastRules = () => mockNative.setRules.mock.calls.at(-1)![0] as { id: string; hour: number; minute: number; days: number[] }[];

beforeEach(() => {
  jest.clearAllMocks();
  mockModule = mockNative;
  mockNative.requestPermission.mockResolvedValue('granted');
  mockNative.setRules.mockResolvedValue(undefined);
  mockNative.cancelAll.mockResolvedValue(undefined);
});

describe('Reminders section', () => {
  it('starts with everything off and asks for no permission', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    expect(await screen.findByText('Reminders')).toBeTruthy();
    for (const label of ['Weigh-in', 'Workout days', 'Log lunch', 'Log dinner', 'Water']) expect(screen.getByLabelText(label).props.value).toBe(false);
    expect(mockNative.requestPermission).not.toHaveBeenCalled();
    expect(lastRules()).toEqual([]); // nothing scheduled on start
  });

  it('turning weigh-in on asks permission, saves on the device and schedules it', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    await waitFor(() => expect(lastRules()).toHaveLength(1));
    expect(mockNative.requestPermission).toHaveBeenCalledTimes(1);
    expect(lastRules()[0]).toMatchObject({ id: 'weigh_in', hour: 7, minute: 30 });
    expect((await loadReminderPrefs(db)).weigh_in.on).toBe(true);
    expect(screen.getByLabelText('Weigh-in time').props.value).toBe('07:30');
  });

  it('a refused permission leaves the reminder off and says why', async () => {
    mockNative.requestPermission.mockResolvedValue('denied');
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Log lunch'), 'valueChange', true);
    expect(await screen.findByText(/Notifications are off for Plate & Bar/)).toBeTruthy();
    expect(screen.getByLabelText('Log lunch').props.value).toBe(false);
    expect((await loadReminderPrefs(db)).lunch.on).toBe(false);
    expect(lastRules()).toEqual([]);
  });

  it('a valid time is kept, an invalid one is not', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    await waitFor(() => expect(lastRules()).toHaveLength(1));
    await fireEvent.changeText(screen.getByLabelText('Weigh-in time'), '25:00');
    expect(await screen.findByText('Use 24-hour time, like 07:30.')).toBeTruthy();
    expect((await loadReminderPrefs(db)).weigh_in.time).toBe('07:30');
    await fireEvent.changeText(screen.getByLabelText('Weigh-in time'), '08:15');
    await waitFor(() => expect(lastRules()[0]).toMatchObject({ hour: 8, minute: 15 }));
    expect((await loadReminderPrefs(db)).weigh_in.time).toBe('08:15');
  });

  it('a time inside quiet hours is kept as set, scheduled where they end, and says so', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    await fireEvent.changeText(await screen.findByLabelText('Weigh-in time'), '06:45');
    expect(await screen.findByText('Goes off at 07:00, when quiet hours end.')).toBeTruthy();
    await waitFor(() => expect(lastRules()[0]).toMatchObject({ hour: 7, minute: 0 }));
    expect((await loadReminderPrefs(db)).weigh_in.time).toBe('06:45');
  });

  it('workout days follow the plan, also when the plan changes', async () => {
    const db = await openDb();
    const r = await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Workout days'), 'valueChange', true);
    await waitFor(() => expect(lastRules()[0]?.days).toEqual([1, 3, 5]));
    await r.rerender(<RemindersSection db={db} profile={{ days: 4 }} />);
    await waitFor(() => expect(lastRules()[0]?.days).toEqual([1, 2, 4, 5]));
  });

  it('sets the saved schedule again on each start', async () => {
    const db = await openDb();
    const first = await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Water'), 'valueChange', true);
    await waitFor(() => expect(lastRules().length).toBe(5));
    await first.unmount();
    mockNative.setRules.mockClear();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await waitFor(() => expect(mockNative.setRules).toHaveBeenCalled());
    expect(lastRules().map((x) => x.id)).toEqual(['water_0', 'water_1', 'water_2', 'water_3', 'water_4']);
  });

  it('says so where there is no native module', async () => {
    mockModule = null; 
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    expect(await screen.findByText('Reminders are not available on this device yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Weigh-in')).toBeNull();
  });
});

describe('deleting the data', () => {
  it('removes the choices and cancels every alarm', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    await waitFor(() => expect(lastRules()).toHaveLength(1));
    expect(await getKv(db, KEY_REMINDERS)).not.toBeNull();
    await act(async () => void (await wipeLocalStore(db, { force: true })));
    expect(await getKv(db, KEY_REMINDERS)).toBeNull();
    expect(mockNative.cancelAll).toHaveBeenCalledTimes(1);
  });

  it('a refused wipe (unsynced changes) keeps the reminders', async () => {
    const db = await openDb();
    await db.runAsync("INSERT INTO sync_outbox (tbl, key, queued_at) VALUES ('weights', 'x', '2026-10-18T00:00:00Z')");
    await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '{}')", KEY_REMINDERS);
    expect(await wipeLocalStore(db)).toBe(1);
    expect(await getKv(db, KEY_REMINDERS)).toBe('{}');
    expect(mockNative.cancelAll).not.toHaveBeenCalled();
  });
});

describe('on the web', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is not offered on the web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const db = await openDb();
    const r = await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await turns();
    expect(r.toJSON()).toBeNull();
    expect(mockNative.requestPermission).not.toHaveBeenCalled();
  });
});
