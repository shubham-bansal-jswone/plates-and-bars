import { useState } from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buildLocalExport } from '../src/account/exportLocal';
import { RESTORE_COPY as rc } from '../src/account/copy';
import { DataScreen } from '../src/screens/DataScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { ProfileProvider, useProfile } from '../src/state/ProfileProvider';
import { useLabHold } from '../src/labs/useLabHold';
import { saveHold } from '../src/db/labs';
import { openDb } from './sync-helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: async () => undefined }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
const mockPick = jest.fn();
jest.mock('../src/account/pickFile', () => ({ pickExportText: () => mockPick() }));

const base = { configured: true, signedIn: false, linked: false, wipePending: false, lastDeletion: null, clearLastDeletion: () => undefined, pending: 0, syncing: false, last: null, epoch: 0, quarantined: 0, accountFull: false, signInUnavailable: false, syncNow: async () => null } as unknown as SyncState;

function Probe({ db }: { db: Awaited<ReturnType<typeof openDb>> }) {
  const p = useProfile();
  const hold = useLabHold(db);
  return <Text>{`profile:${p.status === 'ready' ? (p.profile ? 'yes' : 'no') : 'loading'} hold:${String(hold)}`}</Text>;
}

/** What the app root does: dataVersion lives in the sync provider, and the stores reload on it. */
function Root({ db }: { db: Awaited<ReturnType<typeof openDb>> }) {
  const [dataVersion, setV] = useState(0);
  return (
    <SyncContext.Provider value={{ ...base, dataVersion, dataChanged: () => setV((v) => v + 1) }}>
      <ProfileProvider db={db} reloadKey={dataVersion}>
        <Probe db={db} />
        <DataScreen db={db} />
      </ProfileProvider>
    </SyncContext.Provider>
  );
}

describe('after a restore the stores reload without a remount (#1177)', () => {
  const OLD = process.env.EXPO_PUBLIC_LAB_REPORTS;
  beforeAll(() => void (process.env.EXPO_PUBLIC_LAB_REPORTS = '1'));
  afterAll(() => void (process.env.EXPO_PUBLIC_LAB_REPORTS = OLD));

  it('shows the restored profile and a restored lab hold at once', async () => {
    const other = await openDb();
    const meta = { version: 1, updated_at: '2026-10-08T06:00:00.000Z', deleted_at: null };
    const profile = { ...meta, id: null, name: 'A', sex: 'male', age: 30, height_cm: 180, weight_kg: 80, activity: 1.4, goal: 'maintain', rate: 0 };
    await other.runAsync('INSERT INTO profiles (key, data) VALUES (?, ?)', 'me', JSON.stringify(profile));
    await saveHold(other, { on: true, since: '2026-10-01' });
    mockPick.mockResolvedValue(JSON.stringify((await buildLocalExport(other)).file));

    const db = await openDb();
    await render(<Root db={db} />);
    expect(await screen.findByText('profile:no hold:false')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(rc.action));
    await fireEvent.press(await screen.findByLabelText(rc.confirm));
    await waitFor(() => expect(screen.getByText('profile:yes hold:true')).toBeTruthy());
  });
});
