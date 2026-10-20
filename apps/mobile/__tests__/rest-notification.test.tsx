import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { REST_EXTEND_SEC } from '@plate-and-bar/core';
import { DEFAULT_PREFS } from '../src/reminders/schedule';
import { applyEcho } from '../src/reminders/rest';
import { saveReminderPrefs } from '../src/reminders/store';
import { RestColdStart } from '../src/reminders/RestColdStart';
import { useRestNotification } from '../src/reminders/useRestNotification';
import { openDb } from './sync-helpers';

const mockNative = { getPermissionStatus: jest.fn(), requestPermission: jest.fn(), setRules: jest.fn(), cancelAll: jest.fn(), showRest: jest.fn(), takeRest: jest.fn() };
jest.mock('../src/reminders/native', () => ({ __esModule: true, get default() { return mockNative; } }));
jest.mock('expo-crypto', () => require('./sync-crypto-mock')); // eslint-disable-line @typescript-eslint/no-require-imports

interface Rest { id: number; end: number; total: number; label: string }
const NOW = 1_800_000_000_000;
const running = (over: Partial<Rest> = {}): Rest => ({ id: 7, end: NOW + 90_000, total: 90, label: 'Next: set 2', ...over });

let handler: (s: string) => void = () => {};
let current: Rest | null = null;
let remove: jest.Mock;

function Harness({ db, start, active = true }: { db: Awaited<ReturnType<typeof openDb>>; start: Rest | null; active?: boolean }) {
  const [rest, setRest] = useState<Rest | null>(start);
  useEffect(() => {
    current = rest;
  }, [rest]);
  useRestNotification({ db, rest, setRest, sessionActive: active });
  return null;
}

const setup = async (opts: { on?: boolean; start?: Rest | null; active?: boolean } = {}) => {
  const db = await openDb();
  if (opts.on !== false) await saveReminderPrefs(db, { ...DEFAULT_PREFS, rest: { on: true } });
  const view = await render(<Harness db={db} start={opts.start === undefined ? running() : opts.start} active={opts.active ?? true} />);
  await act(async () => {}); // the setting is read
  return { db, view };
};
const setState = (v: string) => {
  Object.defineProperty(AppState, 'currentState', { value: v, configurable: true, writable: true });
};
const go = async (state: string) => {
  await act(async () => handler(state));
  await act(async () => {});
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: (s: string) => void) => {
    handler = l;
    return { remove };
  }) as never);
  setState('background');
  mockNative.getPermissionStatus.mockResolvedValue('granted');
  mockNative.showRest.mockResolvedValue(undefined);
  mockNative.takeRest.mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe('rest timer notification', () => {
  it('shows the countdown to the absolute end when the app goes to the background during a rest', async () => {
    await setup();
    await go('background');
    expect(mockNative.showRest).toHaveBeenCalledTimes(1);
    expect(mockNative.showRest.mock.calls[0]![0]).toMatchObject({ id: 7, end: NOW + 90_000, extendMs: REST_EXTEND_SEC * 1000, extendLabel: '+30 s', skipLabel: 'Skip rest' });
  });

  it('does not put the exercise or any set detail in the notification text', async () => {
    await setup();
    await go('background');
    expect(JSON.stringify(mockNative.showRest.mock.calls[0]![0])).not.toMatch(/set 2/i);
  });

  it('clears a countdown left from before the process died when the app starts on another tab (a cold start sends no AppState change)', async () => {
    // Only the root component is mounted: the Workout tab (and its hook) is never shown.
    await render(<RestColdStart />);
    await act(async () => {});
    expect(mockNative.takeRest).toHaveBeenCalledTimes(1);
    expect(mockNative.showRest).not.toHaveBeenCalled();
  });

  it('does not take the rest again when the Workout tab mounts later, so a stale echo is never applied', async () => {
    mockNative.takeRest.mockResolvedValue({ id: 7, end: NOW + 120_000, skipped: false });
    await render(<RestColdStart />);
    await act(async () => {});
    await setup();
    expect(mockNative.takeRest).toHaveBeenCalledTimes(1);
    expect(current).toEqual(running());
  });

  it('reads the setting when the app goes to the background, so a switch turned on a moment ago counts', async () => {
    const { db } = await setup({ on: false });
    await saveReminderPrefs(db, { ...DEFAULT_PREFS, rest: { on: true } });
    await go('background');
    expect(mockNative.showRest).toHaveBeenCalledTimes(1);
  });

  it('takes it down when the app comes back to the foreground', async () => {
    await setup();
    await go('background');
    setState('active');
    await go('active');
    expect(mockNative.takeRest).toHaveBeenCalledTimes(1);
  });

  it('takes it down when it finishes showing after the app is already back in the foreground', async () => {
    await setup();
    setState('active');
    await go('background');
    await waitFor(() => expect(mockNative.takeRest).toHaveBeenCalledTimes(1));
  });

  it('takes it down when the session ends', async () => {
    const { db, view } = await setup();
    await view.rerender(<Harness db={db} start={running()} active={false} />);
    await waitFor(() => expect(mockNative.takeRest).toHaveBeenCalledTimes(1));
  });

  it('takes it down when the screen closes', async () => {
    const { view } = await setup();
    await view.unmount();
    expect(mockNative.takeRest).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
  });

  it('shows nothing when no rest is running, or the session is over', async () => {
    await setup({ start: null });
    await go('background');
    await setup({ active: false });
    await go('background');
    expect(mockNative.showRest).not.toHaveBeenCalled();
  });

  it('never shows a stale end time: a rest that is already over is not handed to the module', async () => {
    await setup({ start: running({ end: NOW - 1 }) });
    await go('background');
    expect(mockNative.showRest).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off (the default)', async () => {
    await setup({ on: false });
    await go('background');
    expect(mockNative.showRest).not.toHaveBeenCalled();
  });

  it('does nothing, and leaves the in-app timer alone, when notifications are denied', async () => {
    mockNative.getPermissionStatus.mockResolvedValue('denied');
    await setup();
    await go('background');
    expect(mockNative.showRest).not.toHaveBeenCalled();
    expect(current).toEqual(running());
  });

  it('survives the module failing', async () => {
    mockNative.showRest.mockRejectedValue(new Error('boom'));
    await setup();
    await go('background');
    expect(current).toEqual(running());
  });

  it('+30 s from the notification moves the end of the rest, as the in-app +30 s does', async () => {
    await setup();
    await go('background');
    mockNative.takeRest.mockResolvedValue({ id: 7, end: NOW + 90_000 + REST_EXTEND_SEC * 1000, skipped: false });
    setState('active');
    await go('active');
    expect(current).toMatchObject({ id: 7, end: NOW + 90_000 + REST_EXTEND_SEC * 1000, total: 90 + REST_EXTEND_SEC });
  });

  it('Skip rest from the notification ends the rest', async () => {
    await setup();
    await go('background');
    mockNative.takeRest.mockResolvedValue({ id: 7, end: NOW + 90_000, skipped: true });
    setState('active');
    await go('active');
    expect(current).toBeNull();
  });
});

describe('applyEcho', () => {
  const r = running();
  it('ignores an echo for another rest, so a stale one cannot move or end the current rest', () => {
    expect(applyEcho(r, { id: 6, end: r.end + 30_000, skipped: false })).toBe(r);
    expect(applyEcho(r, { id: 6, end: r.end, skipped: true })).toBe(r);
  });
  it('does nothing without a rest or an echo', () => {
    expect(applyEcho(null, { id: 7, end: 1, skipped: true })).toBeNull();
    expect(applyEcho(r, null)).toBe(r);
  });
  it('never shortens a rest', () => {
    expect(applyEcho(r, { id: 7, end: r.end - 1000, skipped: false })).toBe(r);
  });
});
