import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { bumpStoreEpoch } from '../src/db/storeEpoch';
import { RemindersSection } from '../src/reminders/RemindersSection';
import { DEFAULT_PREFS } from '../src/reminders/schedule';
import { loadReminderPrefs, saveReminderPrefs } from '../src/reminders/store';
import { wipeLocalStore } from '../src/sync/guard';
import { KEY_REMINDERS, getKv } from '../src/sync/store';
import { openDb, turns } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]) }));
const mockNative = { getPermissionStatus: jest.fn(), requestPermission: jest.fn(), setRules: jest.fn(), cancelAll: jest.fn() };
let mockModule: typeof mockNative | null = mockNative;
jest.mock('../src/reminders/native', () => ({ __esModule: true, get default() { return mockModule; } }));
jest.mock('expo-crypto', () => require('./sync-crypto-mock')); // eslint-disable-line @typescript-eslint/no-require-imports

const lastRules = () => mockNative.setRules.mock.calls.at(-1)![0] as { id: string; hour: number; minute: number; days: number[] }[];

beforeEach(() => {
  jest.clearAllMocks();
  mockModule = mockNative;
  mockNative.requestPermission.mockResolvedValue('granted');
  mockNative.getPermissionStatus.mockResolvedValue('granted');
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
    expect(mockNative.setRules).not.toHaveBeenCalled(); // restoring the schedule at start is ReminderRestore's job
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

  it('reads a time when the box is left: a valid one is kept, an invalid one is refused with a reason', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    await waitFor(() => expect(lastRules()).toHaveLength(1));
    const box = screen.getByLabelText('Weigh-in time');
    await fireEvent.changeText(box, '2500');
    await fireEvent(box, 'blur');
    expect(await screen.findByText('Hours go from 00 to 23 and minutes from 00 to 59.')).toBeTruthy();
    expect((await loadReminderPrefs(db)).weigh_in.time).toBe('07:30');
    await fireEvent.changeText(box, '815');
    expect(screen.queryByText(/Hours go from/)).toBeNull(); // the reason goes while typing again
    await fireEvent(box, 'blur');
    await waitFor(() => expect(lastRules()[0]).toMatchObject({ hour: 8, minute: 15 }));
    expect((await loadReminderPrefs(db)).weigh_in.time).toBe('08:15');
    expect(screen.getByLabelText('Weigh-in time').props.value).toBe('08:15'); // shown in full
  });

  it('nothing is saved while typing: "8" on the way to "815" is not a time', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    await waitFor(() => expect(lastRules()).toHaveLength(1));
    mockNative.setRules.mockClear();
    await fireEvent.changeText(screen.getByLabelText('Weigh-in time'), '08');
    await turns();
    expect(mockNative.setRules).not.toHaveBeenCalled();
  });

  it('shows a visible Time caption over each of the four time boxes', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    for (const label of ['Weigh-in', 'Workout days', 'Log lunch', 'Log dinner']) await fireEvent(await screen.findByLabelText(label), 'valueChange', true);
    await waitFor(() => expect(screen.getAllByText('Time', { includeHiddenElements: true })).toHaveLength(4));
  });

  it('a change made before a wipe is not written into the wiped store', async () => {
    let answer!: (s: string) => void;
    mockNative.requestPermission.mockReturnValue(new Promise((r) => void (answer = r)));
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true); // waits on the permission dialog
    bumpStoreEpoch(); // the store is wiped meanwhile
    await act(async () => answer('granted'));
    await turns();
    expect(await getKv(db, KEY_REMINDERS)).toBeNull();
    expect(mockNative.setRules).not.toHaveBeenCalled();
  });

  it('says so when notifications are off in the phone settings while a reminder is on', async () => {
    mockNative.getPermissionStatus.mockResolvedValue('denied');
    const db = await openDb();
    await saveReminderPrefs(db, { ...DEFAULT_PREFS, weigh_in: { on: true, time: '07:30' } });
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    expect(await screen.findByText(/Notifications are off for Plate & Bar/)).toBeTruthy();
  });

  it('says nothing about the phone settings while every reminder is off', async () => {
    mockNative.getPermissionStatus.mockResolvedValue('denied');
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await screen.findByText('Reminders');
    await turns();
    expect(mockNative.getPermissionStatus).toHaveBeenCalled();
    expect(screen.queryByText(/Notifications are off for Plate & Bar/)).toBeNull();
  });

  it('a time inside quiet hours is kept as set, scheduled where they end, and says so', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Weigh-in'), 'valueChange', true);
    const box = await screen.findByLabelText('Weigh-in time');
    await fireEvent.changeText(box, '06:45');
    await fireEvent(box, 'blur');
    expect(await screen.findByText('Goes off at 07:00, when quiet hours end.')).toBeTruthy();
    await waitFor(() => expect(lastRules()[0]).toMatchObject({ hour: 7, minute: 0 }));
    expect((await loadReminderPrefs(db)).weigh_in.time).toBe('06:45');
  });

  it('workout days follow the plan when the reminder is set', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Workout days'), 'valueChange', true);
    await waitFor(() => expect(lastRules()[0]?.days).toEqual([1, 3, 5]));
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
