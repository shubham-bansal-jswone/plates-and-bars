import { Component, useEffect as mockUseEffect, useState as mockUseState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import RootLayout from '../app/_layout';

// The root layout with the database provider replaced by one that fails to open on demand (#1232).
let mockOpens: Array<unknown>; // per open attempt: an error to throw, or undefined to succeed
let mockAttempts = 0;
// Like the real provider: it opens in an effect and a failed open is thrown from render.
jest.mock('expo-sqlite', () => ({
  SQLiteProvider: ({ children }: { children: unknown }) => {
    const [state, setState] = mockUseState<{ error?: unknown; ok?: boolean }>({});
    mockUseEffect(() => {
      mockAttempts += 1;
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
const MESSAGE = 'Plate & Bar is open in another tab. Close it, then retry.';
const original = Platform.OS;

beforeEach(() => {
  jest.useFakeTimers();
  mockAttempts = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined); // React logs caught render errors
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  Platform.OS = original;
});

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

async function elapse(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Runs every back-off wait, one after the other (each retry schedules the next). */
async function giveUp() {
  for (const ms of [250, 500, 1250]) await elapse(ms);
}

describe('second tab on web', () => {
  beforeEach(() => {
    Platform.OS = 'web';
  });

  it('retries the open with a back-off, then shows the other-tab message with Retry', async () => {
    mockOpens = [HANDLE, HANDLE, HANDLE, HANDLE, HANDLE];
    await render(<RootLayout />);
    expect(mockAttempts).toBe(1);
    expect(screen.queryByText(MESSAGE)).toBeNull(); // still retrying
    await elapse(250);
    expect(mockAttempts).toBe(2);
    await elapse(500);
    expect(mockAttempts).toBe(3);
    expect(screen.queryByText(MESSAGE)).toBeNull();
    await elapse(1250);
    expect(mockAttempts).toBe(4);
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await elapse(10000);
    expect(mockAttempts).toBe(4); // gave up
  });

  it('recovers by itself when the other tab closes during the back-off', async () => {
    mockOpens = [HANDLE, undefined];
    await render(<RootLayout />);
    await elapse(250);
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(mockAttempts).toBe(2);
  });

  it('Retry re-attempts the open and loads the app', async () => {
    mockOpens = [HANDLE, HANDLE, HANDLE, HANDLE, undefined];
    await render(<RootLayout />);
    await giveUp();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(mockAttempts).toBe(5);
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('Retry that fails again retries, then shows the message again', async () => {
    mockOpens = [HANDLE, HANDLE, HANDLE, HANDLE, HANDLE, HANDLE, HANDLE, HANDLE];
    await render(<RootLayout />);
    await giveUp();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    });
    await giveUp();
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('does not show the other-tab message for any other error', async () => {
    mockOpens = [new Error('disk full')];
    await render(<Catcher><RootLayout /></Catcher>);
    await act(async () => {});
    expect(screen.getByText('surfaced: disk full')).toBeTruthy();
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(mockAttempts).toBe(1); // and is not retried
  });
});

it('native is unchanged: an access-handle error is not retried or reworded', async () => {
  Platform.OS = 'android';
  mockOpens = [HANDLE];
  await render(<Catcher><RootLayout /></Catcher>);
  await act(async () => {});
  expect(screen.getByText(/^surfaced: Failed to execute/)).toBeTruthy();
  expect(screen.queryByText(MESSAGE)).toBeNull();
  expect(mockAttempts).toBe(1);
});
