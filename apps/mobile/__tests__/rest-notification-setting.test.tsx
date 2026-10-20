import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RemindersSection } from '../src/reminders/RemindersSection';
import { DEFAULT_PREFS, parsePrefs } from '../src/reminders/schedule';
import { loadReminderPrefs } from '../src/reminders/store';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]) }));
const mockNative = { getPermissionStatus: jest.fn(), requestPermission: jest.fn(), setRules: jest.fn(), cancelAll: jest.fn(), showRest: jest.fn(), takeRest: jest.fn() };
jest.mock('../src/reminders/native', () => ({ __esModule: true, get default() { return mockNative; } }));
jest.mock('expo-crypto', () => require('./sync-crypto-mock')); // eslint-disable-line @typescript-eslint/no-require-imports

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.requestPermission.mockResolvedValue('granted');
  mockNative.getPermissionStatus.mockResolvedValue('granted');
  mockNative.setRules.mockResolvedValue(undefined);
});

describe('Rest timer notifications setting', () => {
  it('is off by default, and a stored value that is not true keeps it off', () => {
    expect(DEFAULT_PREFS.rest.on).toBe(false);
    expect(parsePrefs(null).rest.on).toBe(false);
    expect(parsePrefs(JSON.stringify({ rest: { on: 'yes' } })).rest.on).toBe(false);
    expect(parsePrefs(JSON.stringify({ rest: { on: true } })).rest.on).toBe(true);
  });

  it('is a labelled switch, off at first, that asks for the permission and saves on the device when turned on', async () => {
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    const sw = await screen.findByLabelText('Rest timer notifications');
    expect(sw.props.value).toBe(false);
    expect(mockNative.requestPermission).not.toHaveBeenCalled();
    await fireEvent(sw, 'valueChange', true);
    await waitFor(async () => expect((await loadReminderPrefs(db)).rest.on).toBe(true));
    expect(mockNative.requestPermission).toHaveBeenCalledTimes(1);
    expect(mockNative.setRules).toHaveBeenLastCalledWith([]); // it schedules no reminder
  });

  it('stays off, and says why, when the permission is refused', async () => {
    mockNative.requestPermission.mockResolvedValue('denied');
    const db = await openDb();
    await render(<RemindersSection db={db} profile={{ days: 3 }} />);
    await fireEvent(await screen.findByLabelText('Rest timer notifications'), 'valueChange', true);
    expect(await screen.findByText(/Notifications are off for Plate & Bar/)).toBeTruthy();
    expect(screen.getByLabelText('Rest timer notifications').props.value).toBe(false);
    expect((await loadReminderPrefs(db)).rest.on).toBe(false);
  });
});
