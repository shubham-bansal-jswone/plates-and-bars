import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SyncBadge, badgeLabel } from '../src/sync/SyncBadge';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';

const mockBack = jest.fn();
let mockPath = '/targets';
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }), usePathname: () => mockPath }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const base: SyncState = {
  configured: true, signedIn: false, pending: 0, syncing: false, last: null, epoch: 0,
  syncNow: async () => null,
  startSignIn: async () => ({ ok: true, resendAfterSec: 60 }),
  verifyCode: async () => ({ kind: 'signed_in', wiped: false }),
  signOut: async () => 0,
  discardAndSignOut: async () => undefined,
};
const withSync = (s: Partial<SyncState>, ui: React.ReactElement) => <SyncContext.Provider value={{ ...base, ...s }}>{ui}</SyncContext.Provider>;

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
  it('signs in with an emailed code and goes back', async () => {
    const verifyCode = jest.fn(async () => ({ kind: 'signed_in' as const, wiped: false }));
    await render(withSync({ verifyCode }, <SignInScreen />));
    await fireEvent.changeText(screen.getByLabelText('Email address'), 'asha@example.com');
    await fireEvent.press(screen.getByLabelText('Send code'));
    await fireEvent.changeText(await screen.findByLabelText('6-digit code'), '482913');
    await fireEvent.press(screen.getByLabelText('Sign in'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
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
