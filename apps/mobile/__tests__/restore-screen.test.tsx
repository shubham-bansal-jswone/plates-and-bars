import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DataScreen } from '../src/screens/DataScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { RESTORE_COPY as rc } from '../src/account/copy';
import { RestoreError } from '../src/account/restoreLocal';
import { memoryDb } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
const mockPick = jest.fn();
jest.mock('../src/account/pickFile', () => ({ pickExportText: () => mockPick() }));
const mockApply = jest.fn(async () => undefined);
const mockParse = jest.fn();
jest.mock('../src/account/restoreLocal', () => {
  class RestoreError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    RestoreError,
    parseRestore: (t: string) => mockParse(t),
    previewRestore: async () => ({ tables: { food_logs: { added: 2, newer: 1, older: 0, conflicts: 0, same: 0 } }, differentAccount: false, deviceOnly: { cycle: false, labReports: 0, hold: false } }),
    applyRestore: () => mockApply(),
  };
});

const state = { configured: true, signedIn: false, linked: false, wipePending: false, lastDeletion: null, clearLastDeletion: () => undefined, pending: 0, syncing: false, last: null, epoch: 0, dataVersion: 0, quarantined: 0, accountFull: false, signInUnavailable: false, syncNow: async () => null } as unknown as SyncState;
const show = () => render(<SyncContext.Provider value={state}><DataScreen db={memoryDb()} /></SyncContext.Provider>);

beforeEach(() => {
  mockApply.mockClear();
  mockParse.mockReset();
  mockPick.mockReset();
});

describe('restore from a file on the data screen (#1177)', () => {
  it('shows a summary and writes nothing when the user cancels at the confirmation', async () => {
    mockPick.mockResolvedValue('{}');
    mockParse.mockResolvedValue({});
    await show();
    await fireEvent.press(screen.getByLabelText(rc.action));
    expect(await screen.findByText(rc.title)).toBeTruthy();
    expect(screen.getByText(/food_logs: 2 new, 1 newer/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(rc.cancel));
    expect(mockApply).not.toHaveBeenCalled();
    expect(screen.getByLabelText(rc.action)).toBeTruthy();
  });

  it('applies only after the explicit confirmation', async () => {
    mockPick.mockResolvedValue('{}');
    mockParse.mockResolvedValue({});
    await show();
    await fireEvent.press(screen.getByLabelText(rc.action));
    await fireEvent.press(await screen.findByLabelText(rc.confirm));
    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(rc.done)).toBeTruthy();
  });

  it('shows a clear message for a refused file and a cancelled picker does nothing', async () => {
    mockPick.mockResolvedValueOnce('x');
    mockParse.mockRejectedValue(new RestoreError('bad_version'));
    await show();
    await fireEvent.press(screen.getByLabelText(rc.action));
    expect(await screen.findByText(rc.errors.bad_version)).toBeTruthy();
    mockPick.mockResolvedValueOnce(null);
    await fireEvent.press(screen.getByLabelText(rc.action));
    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(2));
    expect(mockApply).not.toHaveBeenCalled();
  });
});
