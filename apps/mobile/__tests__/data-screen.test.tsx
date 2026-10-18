import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DataScreen } from '../src/screens/DataScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { DeletionNotice } from '../src/account/DeletionNotice';
import { SYNC_TABLES, type SyncTableName } from '../src/db/outbox';
import { DATA_COPY } from '../src/account/copy';
import { memoryDb } from './helpers';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: mockPush, replace: mockReplace, canGoBack: () => true }) }));
const mockSave = jest.fn(async (): Promise<'saved' | 'shared' | 'unavailable'> => 'saved');
jest.mock('../src/account/saveFile', () => ({ clearOldExports: () => undefined, saveTextFile: (...a: unknown[]) => (mockSave as unknown as (...x: unknown[]) => unknown)(...a) }));
jest.mock('../src/account/exportLocal', () => ({ buildLocalExport: async () => ({ file: { exported_at: '2026-10-09T08:00:00.000Z' }, csv: 'date' }) }));

const base: SyncState = {
  configured: true, signedIn: false, linked: false, wipePending: false, lastDeletion: null, clearLastDeletion: () => undefined, pending: 0, syncing: false, last: null, epoch: 0, dataVersion: 0, quarantined: 0, accountFull: false, signInUnavailable: false, retryQuarantined: async () => undefined, discardQuarantined: async () => undefined, holdSchedule: () => undefined,
  syncNow: async () => null,
  startSignIn: async () => ({ ok: true, resendAfterSec: 60 }),
  verifyCode: async () => ({ kind: 'signed_in', wiped: false }),
  signOut: async () => 0,
  discardAndSignOut: async () => undefined,
  exportFromServer: async () => ({ kind: 'not_signed_in' }),
  deleteEverything: async () => ({ kind: 'deleted', server: false, linked: false }),
};
const consentRow = JSON.stringify({ id: 'c1', version: 1, updated_at: '2026-10-01T00:00:00.000Z', deleted_at: null, kind: 'data_storage', given_at: '2026-10-01T00:00:00.000Z', text_version: '1' });
const consented = () => {
  const db = memoryDb();
  db.rows.set('consents:c1', consentRow);
  return db;
};
const show = (s: Partial<SyncState>, db = memoryDb()) =>
  render(
    <SyncContext.Provider value={{ ...base, ...s }}>
      <DataScreen db={db} />
    </SyncContext.Provider>,
  );

beforeEach(() => {
  mockSave.mockClear();
  mockReplace.mockClear();
});

describe('data screen (#27)', () => {
  it('says withdrawing consent means deleting the account, on Data and on the delete confirmation', async () => {
    await show({ signedIn: true });
    expect(screen.getByText(DATA_COPY.withdraw)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    expect(screen.getByText(DATA_COPY.withdraw)).toBeTruthy();
  });

  it('says where the data is stored: this device when signed out, the account when signed in, this browser on web', async () => {
    const first = await show({});
    expect(screen.getByText(DATA_COPY.storageDevice)).toBeTruthy();
    expect(screen.queryByText(/waiting to sync/)).toBeNull();
    await first.unmount();
    const second = await show({ signedIn: true }, consented());
    expect(await screen.findByText('Saved privately to your account.')).toBeTruthy();
    await second.unmount();
    const was = Platform.OS;
    Platform.OS = 'web';
    try {
      await show({});
      expect(screen.getByText('Saved in this browser only.')).toBeTruthy();
    } finally {
      Platform.OS = was;
    }
  });

  it('shows no storage line to a signed-in user until the consent has been read, so it never flashes "device only"', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const db = consented();
    const read = db.getAllAsync.bind(db);
    // Hold the consent read open to observe the unresolved state.
    db.getAllAsync = (async (...a: Parameters<typeof read>) => {
      await gate;
      return read(...a);
    }) as typeof db.getAllAsync;
    await show({ signedIn: true }, db);
    expect(screen.queryByText(DATA_COPY.storageDevice)).toBeNull();
    expect(screen.queryByText('Saved privately to your account.')).toBeNull();
    release();
    expect(await screen.findByText('Saved privately to your account.')).toBeTruthy();
    expect(screen.queryByText(DATA_COPY.storageDevice)).toBeNull();
  });

  it('keeps the buttons where they were when the consent read resolves, so a tap never lands on the late storage line (#1035)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const db = consented();
    const read = db.getAllAsync.bind(db);
    db.getAllAsync = (async (...a: Parameters<typeof read>) => {
      await gate;
      return read(...a);
    }) as typeof db.getAllAsync;
    await show({ signedIn: true }, db);
    // Position of a control = number of nodes rendered before it; content inserted above it would shift this.
    const position = (label: string) => {
      const nodes: { props?: Record<string, unknown> }[] = [];
      const walk = (n: unknown) => {
        if (n === null || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        nodes.push(n as { props?: Record<string, unknown> });
        walk((n as { children?: unknown }).children);
      };
      walk(screen.toJSON());
      return nodes.findIndex((n) => n.props?.accessibilityLabel === label);
    };
    const labels = ['Delete everything', 'Download my data'];
    const before = labels.map(position);
    expect(before.every((i) => i >= 0)).toBe(true);
    release();
    expect(await screen.findByText('Saved privately to your account.')).toBeTruthy();
    expect(labels.map(position)).toEqual(before);
  });

  it('a signed-in user without the data_storage consent is told the data stays on the device, as nothing uploads', async () => {
    await show({ signedIn: true });
    expect(await screen.findByText(DATA_COPY.storageDevice)).toBeTruthy();
    expect(screen.queryByText(/Saved privately to your account/)).toBeNull();
    const withdrawn = memoryDb();
    withdrawn.rows.set('consents:c1', JSON.stringify({ ...JSON.parse(consentRow), deleted_at: '2026-10-02T00:00:00.000Z' }));
    await show({ signedIn: true }, withdrawn);
    expect(screen.queryByText(/Saved privately to your account/)).toBeNull();
  });

  it('says the photos and lab data stay on this device once, not twice, when signed in', async () => {
    await show({ signedIn: true }, consented());
    await screen.findByText('Saved privately to your account.');
    expect(screen.getAllByText(/photos and lab data are not in it; they stay on this device/i)).toHaveLength(1);
  });

  it('adds "Some changes are waiting to sync." while the queue holds records, and drops it when it empties', async () => {
    const view = await show({ pending: 2 });
    expect(screen.getByText('Saved on this device only. Some changes are waiting to sync.')).toBeTruthy();
    await view.rerender(
      <SyncContext.Provider value={{ ...base, pending: 0 }}>
        <DataScreen db={memoryDb()} />
      </SyncContext.Provider>,
    );
    expect(screen.getByText('Saved on this device only.')).toBeTruthy();
    expect(screen.queryByText(/waiting to sync/)).toBeNull();
    const signed = await show({ signedIn: true, pending: 1 }, consented());
    expect(await screen.findByText('Saved privately to your account. Some changes are waiting to sync.')).toBeTruthy();
    await signed.unmount();
  });

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
    const deleteEverything = jest.fn(async () => ({ kind: 'deleted' as const, server: true, linked: true }));
    await show({ signedIn: true, deleteEverything });
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    expect(screen.getByText(/permanently deletes what you entered and your logs on this device/)).toBeTruthy();
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

  it('never signed in, the confirmation says it deletes this device only', async () => {
    await show({});
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    expect(screen.getByText(/not linked to an account/)).toBeTruthy();
    expect(screen.queryByText(/server/)).toBeNull();
  });

  it('linked but signed out: offers sign-in or device-only, never says nothing is on a server, and deletes nothing on sign-in', async () => {
    const deleteEverything = jest.fn(async () => ({ kind: 'deleted' as const, server: false, linked: true }));
    await show({ linked: true, deleteEverything });
    expect(screen.getByLabelText('Sign in to download from your account')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    expect(screen.getByText(/leaves your account and its server data in place/)).toBeTruthy();
    expect(screen.queryByLabelText('Yes, delete everything')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Sign in to delete your account'));
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
    expect(deleteEverything).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Delete only this device'));
    expect(screen.getByText(/Your account and its data on our server stay/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Yes, delete everything'));
    await waitFor(() => expect(deleteEverything).toHaveBeenCalledWith({ deviceOnly: true }));
    expect(await screen.findByText('The data on this device is deleted.')).toBeTruthy();
  });

  it('with the account already deleted and the device wipe pending, only finishing the device is offered, on every visit', async () => {
    const deleteEverything = jest.fn(async () => ({ kind: 'deleted' as const, server: true, linked: true }));
    for (let visit = 0; visit < 2; visit++) {
      const view = await show({ linked: true, wipePending: true, deleteEverything });
      expect(screen.queryByLabelText('Sign in to download from your account')).toBeNull();
      await fireEvent.press(screen.getByLabelText('Delete everything'));
      expect(screen.queryByLabelText('Sign in to delete your account')).toBeNull();
      expect(screen.queryByLabelText('Delete only this device')).toBeNull();
      expect(screen.getByLabelText('Finish deleting this device')).toBeTruthy();
      if (visit === 0) await view.unmount(); // leave the screen and come back
    }
    await fireEvent.press(screen.getByLabelText('Finish deleting this device'));
    await waitFor(() => expect(deleteEverything).toHaveBeenCalledWith(undefined));
  });
});

describe('owner changed', () => {
  it('after the account was deleted it says the device was not cleared, with no "try again"', async () => {
    await show({ signedIn: true, deleteEverything: async () => ({ kind: 'owner_changed', server: true }) });
    await fireEvent.press(screen.getByLabelText('Delete everything'));
    await fireEvent.press(screen.getByLabelText('Yes, delete everything'));
    expect(await screen.findByText(/Your account was deleted. This device was not cleared/)).toBeTruthy();
    expect(screen.queryByText(/Try again/)).toBeNull();
  });
});

describe('deletion notice', () => {
  const at = (lastDeletion: SyncState['lastDeletion'], clearLastDeletion = jest.fn()) => (
    <SyncContext.Provider value={{ ...base, lastDeletion, clearLastDeletion }}>
      <DeletionNotice />
    </SyncContext.Provider>
  );
  it('says what was deleted once, and clears when the screen goes away', async () => {
    const clear = jest.fn();
    const view = await render(at({ server: true, linked: true }, clear));
    expect(screen.getByText(/Everything deleted/)).toBeTruthy();
    expect(clear).not.toHaveBeenCalled();
    await view.unmount();
    expect(clear).toHaveBeenCalled();
    await render(at({ server: false, linked: true }));
    expect(screen.getByText('This device was cleared. Your account still exists.')).toBeTruthy();
  });
  it('a device that never signed in gets no account sentence', async () => {
    await render(at({ server: false, linked: false }));
    expect(screen.getByText('Everything deleted. The data on this device is gone.')).toBeTruthy();
    expect(screen.queryByText(/account still exists/)).toBeNull();
  });
  it('the delete confirmation names every table the wipe clears', () => {
    // One phrase per sync table; a new table in SYNC_TABLES fails the type check here and the test below.
    const named: Record<SyncTableName, string> = {
      profiles: 'profile and targets',
      consents: 'consent record',
      food_logs: 'food',
      water_logs: 'water',
      day_notes: 'day notes',
      workouts: 'workout logs',
      workout_sets: 'sets',
      lift_stats: 'lift history',
      weights: 'weights',
      measurements: 'measurements',
      user_foods: 'your own foods',
      recipes: 'recipes',
      kitchen_tests: 'kitchen tests',
      exclusions: 'exclusions',
      swaps: 'swaps',
      settings: 'settings',
    };
    expect(Object.keys(named).sort()).toEqual(Object.keys(SYNC_TABLES).sort());
    for (const phrase of Object.values(named)) expect(DATA_COPY.confirmDevice).toContain(phrase);
    expect(DATA_COPY.confirmDevice).toContain('waiting to sync');
  });
  it('shows nothing without a deletion or without a provider', async () => {
    await render(at(null));
    expect(screen.queryByText(/deleted|cleared/)).toBeNull();
    await render(<DeletionNotice />);
    expect(screen.queryByText(/deleted|cleared/)).toBeNull();
  });

  it('the reinstall sentence shows on Android only', async () => {
    const original = Platform.OS;
    const android = 'Android does not back up this app, so if you reinstall or move to a new phone, download a copy first.';
    try {
      Platform.OS = 'android';
      const a = await show({});
      expect(screen.getByText(new RegExp(`stay on this device\\. ${android}$`))).toBeTruthy();
      a.unmount();
      Platform.OS = 'ios';
      await show({});
      expect(screen.getByText(/stay on this device\.$/)).toBeTruthy();
      expect(screen.queryByText(/Android does not back up/)).toBeNull();
    } finally {
      Platform.OS = original;
    }
  });
});
