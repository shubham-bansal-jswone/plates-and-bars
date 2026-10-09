import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProfileProvider } from '../src/state/ProfileProvider';
import { memoryDb } from './helpers';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SyncBadge, badgeLabel } from '../src/sync/SyncBadge';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockPath = '/targets';
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn(), replace: mockReplace, canGoBack: () => true }), usePathname: () => mockPath }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const base: SyncState = {
  configured: true, signedIn: false, pending: 0, syncing: false, last: null, epoch: 0,
  dataVersion: 0, holdSchedule: () => undefined,
  syncNow: async () => null,
  startSignIn: async () => ({ ok: true, resendAfterSec: 60 }),
  verifyCode: async () => ({ kind: 'signed_in', wiped: false }),
  signOut: async () => 0,
  discardAndSignOut: async () => undefined,
};
const pdb = memoryDb();
const withSync = (s: Partial<SyncState>, ui: React.ReactElement) => (
  <SyncContext.Provider value={{ ...base, ...s }}>
    <ProfileProvider db={pdb}>{ui}</ProfileProvider>
  </SyncContext.Provider>
);

describe('badge', () => {
  it('labels the three states', () => {
    expect(badgeLabel({ signedIn: false, pending: 0 })).toBe('Sign in to sync');
    expect(badgeLabel({ signedIn: true, pending: 2 })).toBe('Not synced');
    expect(badgeLabel({ signedIn: true, pending: 0 })).toBe('Synced');
  });

  it('says how many changes are unsynced to a screen reader, and is absent in a build without a server', async () => {
    await render(withSync({ signedIn: true, pending: 3 }, <SyncBadge />));
    expect(screen.getByLabelText('Not synced. 3 changes on this device are not synced yet. Opens account')).toBeTruthy();
    await render(withSync({ configured: false }, <SyncBadge />));
    expect(screen.queryByText('Sign in to sync')).toBeNull();
  });
});

describe('sign-in screen', () => {
  it('signs in with an emailed code', async () => {
    const verifyCode = jest.fn(async () => ({ kind: 'signed_in' as const, wiped: false }));
    await render(withSync({ verifyCode }, <SignInScreen />));
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'asha@example.com');
    await fireEvent.press(screen.getByLabelText('Send code'));
    await fireEvent.changeText(await screen.findByLabelText('6-digit code'), '482913');
    await fireEvent.press(screen.getByLabelText('Sign in'));
    await waitFor(() => expect(verifyCode).toHaveBeenCalled());
    expect(verifyCode).toHaveBeenCalledWith('asha@example.com', '482913');
  });

  it('a refused account switch offers the two choices and discarding asks for confirmation with the count', async () => {
    const discardAndSignOut = jest.fn(async () => undefined);
    await render(withSync({ verifyCode: async () => ({ kind: 'refused' as const, pending: 4 }), discardAndSignOut }, <SignInScreen />));
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'b@example.com');
    await fireEvent.press(screen.getByLabelText('Send code'));
    await fireEvent.changeText(await screen.findByLabelText('6-digit code'), '111111');
    await fireEvent.press(screen.getByLabelText('Sign in'));
    expect(await screen.findByLabelText('Sign in as the previous user to sync')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Discard and sign out'));
    expect(await screen.findByText(/deletes 4 unsynced changes/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Discard and sign out'));
    await waitFor(() => expect(discardAndSignOut).toHaveBeenCalled());
  });

  it('sign-out with unsynced changes offers sync first or a confirmed discard, never a plain sign-out', async () => {
    const signOut = jest.fn(async (o?: { discard?: boolean }) => (o?.discard ? 0 : 2));
    const syncNow = jest.fn(async () => null);
    await render(withSync({ signedIn: true, pending: 2, signOut, syncNow }, <SignInScreen />));
    expect(screen.queryByLabelText('Sign out')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Sync now, then sign out'));
    expect(await screen.findByText(/still not synced/)).toBeTruthy();
    expect(syncNow).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Discard and sign out'));
    expect(await screen.findByText(/deletes 2 unsynced changes/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Discard and sign out'));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ discard: true }));
  });
});

describe('sign-in screen extras', () => {
  it('says "1 change" in the singular', async () => {
    await render(withSync({ signedIn: true, pending: 1 }, <SyncBadge />));
    expect(screen.getByLabelText('Not synced. 1 change on this device is not synced yet. Opens account')).toBeTruthy();
  });

  it('asks for consent before syncing, and holds the schedule while a discard is being confirmed', async () => {
    const holdSchedule = jest.fn();
    const syncNow = jest.fn(async () => null);
    await render(withSync({ signedIn: true, pending: 2, last: { status: 'consent_required', conflicts: 0 }, holdSchedule, syncNow }, <SignInScreen />));
    expect(screen.getByText(/agree that Plate & Bar stores your records/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Agree and sync'));
    await waitFor(() => expect(syncNow).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText('Discard and sign out'));
    await screen.findByText(/deletes 2 unsynced changes/);
    expect(holdSchedule).toHaveBeenLastCalledWith(true);
    await fireEvent.press(screen.getByLabelText('Cancel'));
    await waitFor(() => expect(holdSchedule).toHaveBeenLastCalledWith(false));
  });

  it('shows a message for a refused sync and for a local error', async () => {
    await render(withSync({ signedIn: true, last: { status: 'rejected', conflicts: 0 } }, <SignInScreen />));
    expect(screen.getByText(/server refused the last sync/)).toBeTruthy();
    await render(withSync({ signedIn: true, last: { status: 'error', conflicts: 0 } }, <SignInScreen />));
    expect(screen.getByText(/problem on this device/)).toBeTruthy();
  });
});
