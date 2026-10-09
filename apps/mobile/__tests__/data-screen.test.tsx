import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DataScreen } from '../src/screens/DataScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { memoryDb } from './helpers';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: mockReplace, canGoBack: () => true }) }));
const mockSave = jest.fn(async (): Promise<'saved' | 'shared' | 'unavailable'> => 'saved');
jest.mock('../src/account/saveFile', () => ({ saveTextFile: (...a: unknown[]) => (mockSave as unknown as (...x: unknown[]) => unknown)(...a) }));
jest.mock('../src/account/exportLocal', () => ({ buildLocalExport: async () => ({ file: { exported_at: '2026-10-09T08:00:00.000Z' }, csv: 'date' }) }));

const base: SyncState = {
  configured: true, signedIn: false, pending: 0, syncing: false, last: null, epoch: 0, dataVersion: 0, holdSchedule: () => undefined,
  syncNow: async () => null,
  startSignIn: async () => ({ ok: true, resendAfterSec: 60 }),
  verifyCode: async () => ({ kind: 'signed_in', wiped: false }),
  signOut: async () => 0,
  discardAndSignOut: async () => undefined,
  exportFromServer: async () => ({ kind: 'not_signed_in' }),
  deleteEverything: async () => ({ kind: 'deleted', server: false }),
};
const show = (s: Partial<SyncState>) =>
  render(
    <SyncContext.Provider value={{ ...base, ...s }}>
      <DataScreen db={memoryDb()} />
    </SyncContext.Provider>,
  );

beforeEach(() => {
  mockSave.mockClear();
  mockReplace.mockClear();
});

describe('data screen (#27)', () => {
  it('exports from the device with no account: the JSON and the food-log CSV, no server option', async () => {
    await show({});
    expect(screen.queryByLabelText('Download from my account')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Download my data'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    expect(mockSave).toHaveBeenNthCalledWith(1, 'plate-and-bar-export-2026-10-09.json', 'application/json', expect.any(String));
    expect(mockSave).toHaveBeenNthCalledWith(2, 'plate-and-bar-food-log-2026-10-09.csv', 'text/csv', 'date');
  });

  it('signed in, offers the server export and says when offline', async () => {
    const exportFromServer = jest.fn(async () => ({ kind: 'offline' as const }));
    await show({ signedIn: true, exportFromServer });
    await fireEvent.press(screen.getByLabelText('Download from my account'));
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('delete asks first, states what goes (and the account when signed in), and deletes only on confirm', async () => {
    const deleteEverything = jest.fn(async () => ({ kind: 'deleted' as const, server: true }));
    await show({ signedIn: true, deleteEverything });
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    expect(screen.getByText(/permanently deletes everything on this device/)).toBeTruthy();
    expect(screen.getByText(/also deletes your account/)).toBeTruthy();
    expect(deleteEverything).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Yes, delete everything'));
    await waitFor(() => expect(deleteEverything).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your account and the data on this device are deleted.')).toBeTruthy();
  });

  it('a server that is unavailable is shown as not deleted, and never as deleted', async () => {
    await show({ signedIn: true, deleteEverything: async () => ({ kind: 'unavailable' }) });
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    await fireEvent.press(screen.getByLabelText('Yes, delete everything'));
    expect(await screen.findByText(/so nothing was deleted/)).toBeTruthy();
    expect(screen.queryByText(/are deleted/)).toBeNull();
  });

  it('an unconfirmed deletion (refresh failed) asks to sign in instead of claiming deletion', async () => {
    await show({ signedIn: true, deleteEverything: async () => ({ kind: 'unconfirmed' }) });
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    await fireEvent.press(screen.getByLabelText('Yes, delete everything'));
    expect(await screen.findByText(/could not confirm the deletion/)).toBeTruthy();
  });

  it('signed out, the confirmation says nothing is on a server', async () => {
    await show({});
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    expect(screen.getByText(/not signed in/)).toBeTruthy();
  });
});
