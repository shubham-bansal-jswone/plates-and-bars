import { Component, useEffect as mockUseEffect, useState as mockUseState, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import RootLayout from '../app/_layout';

// The root layout with the database provider replaced by one that fails to open on demand (#1232).
let mockOpens: unknown[]; // per open attempt: an error to throw, or undefined to succeed
// Like the real provider: it opens in an effect and a failed open is thrown from render.
jest.mock('expo-sqlite', () => ({
  SQLiteProvider: ({ children }: { children: unknown }) => {
    const [state, setState] = mockUseState<{ error?: unknown; ok?: boolean }>({});
    mockUseEffect(() => {
      const next = mockOpens.shift();
      setState(next ? { error: next } : { ok: true });
    }, []);
    if (state.error) throw state.error;
    return state.ok ? children : null;
  },
  useSQLiteContext: () => ({}),
}));
jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/db/migrations', () => ({ DB_NAME: 'x' }));
jest.mock('../src/db/initDb', () => ({ initDb: () => undefined }));
jest.mock('../src/db/lockedDb', () => ({ lockedDb: (d: unknown) => d }));
jest.mock('../src/content/ContentRefresher', () => ({ ContentRefresher: () => null }));
jest.mock('../src/state/Gate', () => ({ Gate: () => null }));
jest.mock('../src/theme/fonts', () => ({ FontsProvider: ({ children }: { children: unknown }) => children, useFontFamily: () => () => undefined, useFontsReady: () => false }));
jest.mock('../src/sync/db', () => ({ syncDb: (d: unknown) => d }));
jest.mock('../src/sync/SyncBadge', () => ({ SyncBadge: () => null }));
jest.mock('../src/sync/Stores', () => ({ Stores: ({ children }: { children: unknown }) => children }));
jest.mock('../src/sync/SyncProvider', () => ({ SyncProvider: ({ children }: { children: unknown }) => children }));
jest.mock('../src/steps/DeviceStepsProvider', () => ({ DeviceStepsProvider: ({ children }: { children: unknown }) => children }));
jest.mock('../src/reminders/RestColdStart', () => ({ RestColdStart: () => null }));
jest.mock('../src/telemetry/errors', () => ({ initErrorTracking: () => undefined }));
jest.mock('../src/web/registerServiceWorker', () => ({ registerServiceWorker: () => undefined }));

const HANDLE = new Error("Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream");
const VFS = new Error('Invalid VFS state'); // what wa-sqlite hands back after the handle failure
const MESSAGE = 'Plate & Bar is open in another tab. Close it, then retry.';
const original = Platform.OS;
const g = globalThis as unknown as { location: unknown; sessionStorage: unknown };
const saved = { location: g.location, sessionStorage: g.sessionStorage };
let store: Map<string, string>;
const reload = jest.fn();

/** Stands for whatever sits above the root layout: an error that reaches it was not handled. */
class Catcher extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { message: e.message };
  }
  render() {
    return this.state.message === null ? this.props.children : <Text>{`surfaced: ${this.state.message}`}</Text>;
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  store = new Map();
  reload.mockReset();
  g.location = { reload };
  g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  jest.spyOn(console, 'error').mockImplementation(() => undefined); // React logs caught render errors
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  Platform.OS = original;
  g.location = saved.location;
  g.sessionStorage = saved.sessionStorage;
});

async function elapse(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('second tab on web', () => {
  beforeEach(() => {
    Platform.OS = 'web';
  });

  it('reloads with a growing back-off (about 2 s in all) instead of staying blank', async () => {
    mockOpens = [HANDLE];
    const view = await render(<RootLayout />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByText(MESSAGE)).toBeNull(); // still retrying
    await elapse(249);
    expect(reload).not.toHaveBeenCalled();
    await elapse(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get('pb-db-open-tries')).toBe('1');
    await view.unmount();
    // The page loads again and fails again: the second and third waits are longer.
    for (const [tries, wait] of [[1, 500], [2, 1250]] as const) {
      reload.mockReset();
      store.set('pb-db-open-tries', String(tries));
      mockOpens = [VFS];
      const next = await render(<RootLayout />);
      await act(async () => {});
      await elapse(wait - 1);
      expect(reload).not.toHaveBeenCalled();
      await elapse(1);
      expect(reload).toHaveBeenCalledTimes(1);
      await next.unmount();
    }
  });

  it('after the last retry it shows the other-tab message with Retry and stops reloading', async () => {
    store.set('pb-db-open-tries', '3');
    mockOpens = [VFS];
    await render(<RootLayout />);
    await act(async () => {});
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await elapse(10000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('Retry gives the page a fresh set of retries and loads it again', async () => {
    store.set('pb-db-open-tries', '3');
    mockOpens = [HANDLE];
    await render(<RootLayout />);
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.has('pb-db-open-tries')).toBe(false);
  });

  it('a successful open clears the count, so a later failure retries in full again', async () => {
    store.set('pb-db-open-tries', '2');
    mockOpens = [undefined];
    await render(<RootLayout />);
    await act(async () => {});
    expect(store.has('pb-db-open-tries')).toBe(false);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('does not show the other-tab message for any other error, and does not reload', async () => {
    mockOpens = [new Error('disk full')];
    await render(<Catcher><RootLayout /></Catcher>);
    await act(async () => {});
    expect(screen.getByText('surfaced: disk full')).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    await elapse(10000);
    expect(reload).not.toHaveBeenCalled();
  });
});

it('native is unchanged: an access-handle error is not retried or reworded', async () => {
  Platform.OS = 'android';
  mockOpens = [HANDLE];
  await render(<Catcher><RootLayout /></Catcher>);
  await act(async () => {});
  expect(screen.getByText(/^surfaced: Failed to execute/)).toBeTruthy();
  expect(screen.queryByText(MESSAGE)).toBeNull();
  await elapse(10000);
  expect(reload).not.toHaveBeenCalled();
});
