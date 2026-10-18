import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Text } from 'react-native';
import { loadDayNote } from '../src/db/food';
import { DeviceStepsProvider, useStepsVersion } from '../src/steps/DeviceStepsProvider';
import { DeviceStepsSection } from '../src/steps/DeviceStepsSection';
import { STEPS_COPY } from '../src/steps/copy';
import { loadStepsOn, saveStepsOn } from '../src/steps/store';
import { wipeLocalStore } from '../src/sync/guard';
import { openDb } from './sync-helpers';

jest.mock('expo-crypto', () => require('./sync-crypto-mock')); // eslint-disable-line @typescript-eslint/no-require-imports
const mockSensor = {
  supported: true,
  present: true,
  granted: true,
  reading: { counter: 1000, elapsedMs: 1_000_000 } as { counter: number; elapsedMs: number } | null,
  asked: jest.fn(),
  /** When set, a reading waits for it (a read still in flight). */
  gate: null as Promise<void> | null,
};
jest.mock('../src/steps/sensor', () => ({
  deviceStepsSupported: () => mockSensor.supported,
  stepSensorPresent: async () => mockSensor.present,
  stepPermissionGranted: async () => mockSensor.granted,
  requestStepPermission: async (r: unknown) => {
    mockSensor.asked(r);
    return mockSensor.granted;
  },
  readStepCounter: async () => {
    await mockSensor.gate;
    return mockSensor.reading;
  },
}));

let clock = new Date(2026, 9, 8, 10, 0, 0);
const now = () => clock;
const DATE = '2026-10-08';

function Version() {
  return <Text>{`version ${useStepsVersion()}`}</Text>;
}
const LABEL = STEPS_COPY.label;

async function setup(opts: { on?: boolean } = {}) {
  const db = await openDb();
  if (opts.on) await saveStepsOn(db, true);
  await render(
    <DeviceStepsProvider db={db} now={now}>
      <DeviceStepsSection />
      <Version />
    </DeviceStepsProvider>,
  );
  return db;
}
/** Presses the switch and "Continue" in our own dialog. */
async function turnOnViaDialog() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await fireEvent(screen.getByLabelText(LABEL), 'valueChange', true);
  expect(alert).toHaveBeenCalledTimes(1);
  const buttons = alert.mock.calls[0]![2]!;
  return { alert, buttons, cont: () => act(async () => void buttons.find((b) => b.text === STEPS_COPY.askContinue)!.onPress!()) };
}
let appState: (s: string) => void = () => undefined;

beforeEach(() => {
  Object.assign(mockSensor, { supported: true, present: true, granted: true, reading: { counter: 1000, elapsedMs: 1_000_000 } });
  mockSensor.asked.mockReset();
  mockSensor.gate = null;
  clock = new Date(2026, 9, 8, 10, 0, 0);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, h) => {
    appState = h as (s: string) => void;
    return { remove: jest.fn() };
  });
});
afterEach(() => jest.restoreAllMocks());

describe('Phone step counter setting (#300)', () => {
  it('is hidden without a provider and where there is no step sensor (web, iOS)', async () => {
    await render(<DeviceStepsSection />);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    mockSensor.supported = false;
    await setup();
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    expect(screen.queryByText(STEPS_COPY.title)).toBeNull();
  });

  it('is off by default, labelled, and says what it does', async () => {
    const db = await setup();
    expect(screen.getByLabelText(LABEL).props.value).toBe(false);
    expect(screen.getByText(STEPS_COPY.off)).toBeTruthy();
    expect(screen.getByText(STEPS_COPY.how)).toBeTruthy();
    expect(await loadStepsOn(db)).toBe(false);
    expect(await loadDayNote(db, DATE)).toBeNull();
  });

  it('explains first; "Not now" leaves it off and never asks the system', async () => {
    await setup();
    const { alert, buttons } = await turnOnViaDialog();
    expect(alert.mock.calls[0]![0]).toBe(STEPS_COPY.askTitle);
    expect(alert.mock.calls[0]![1]).toBe(STEPS_COPY.askBody);
    expect(buttons.map((b) => b.text)).toEqual([STEPS_COPY.askCancel, STEPS_COPY.askContinue]);
    expect(mockSensor.asked).not.toHaveBeenCalled();
    expect(screen.getByLabelText(LABEL).props.value).toBe(false);
  });

  it('"Continue" asks for the permission with the rationale, turns on, and a later reading fills in the steps as device', async () => {
    const db = await setup();
    await (await turnOnViaDialog()).cont();
    expect(mockSensor.asked).toHaveBeenCalledWith(STEPS_COPY.rationale);
    await waitFor(() => expect(screen.getByLabelText(LABEL).props.value).toBe(true));
    expect(await loadStepsOn(db)).toBe(true);
    expect(await loadDayNote(db, DATE)).toBeNull(); // the first reading only sets the baseline
    mockSensor.reading = { counter: 1900, elapsedMs: 2_000_000 };
    await act(async () => appState('active'));
    await waitFor(async () => expect(await loadDayNote(db, DATE)).toMatchObject({ steps: 900, steps_source: 'device' }));
    expect(screen.getByText('version 1')).toBeTruthy();
    await act(async () => appState('background')); // only coming to the foreground reads
    expect(screen.getByText('version 1')).toBeTruthy();
  });

  it('a refused permission leaves it off and says how to turn it on later', async () => {
    mockSensor.granted = false;
    const db = await setup();
    await (await turnOnViaDialog()).cont();
    expect(await screen.findByText(STEPS_COPY.denied)).toBeTruthy();
    expect(screen.getByLabelText(LABEL).props.value).toBe(false);
    expect(await loadStepsOn(db)).toBe(false);
  });

  it('a phone with no step sensor says so and stays off', async () => {
    mockSensor.present = false;
    await setup();
    await (await turnOnViaDialog()).cont();
    expect(await screen.findByText(STEPS_COPY.noSensor)).toBeTruthy();
    expect(mockSensor.asked).not.toHaveBeenCalled();
    expect(screen.getByLabelText(LABEL).props.value).toBe(false);
  });

  it('when already on it reads at start; turning off stops counting and forgets the baseline', async () => {
    const db = await setup({ on: true });
    await waitFor(() => expect(screen.getByLabelText(LABEL).props.value).toBe(true));
    await waitFor(async () => expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).not.toBeNull());
    await act(async () => void (await fireEvent(screen.getByLabelText(LABEL), 'valueChange', false)));
    await waitFor(() => expect(screen.getByLabelText(LABEL).props.value).toBe(false));
    expect(await loadStepsOn(db)).toBe(false);
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).toBeNull();
    mockSensor.reading = { counter: 5000, elapsedMs: 3_000_000 };
    await act(async () => appState('active'));
    expect(await loadDayNote(db, DATE)).toBeNull();
  });

  it('warns when the permission was taken away while on, and writes nothing', async () => {
    mockSensor.granted = false;
    const db = await setup({ on: true });
    expect(await screen.findByText(STEPS_COPY.lost)).toBeTruthy();
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).toBeNull();
  });

  it('takes a reading when the local day changes while the app runs', async () => {
    jest.useFakeTimers();
    try {
      const db = await setup({ on: true });
      await act(async () => void (await jest.advanceTimersByTimeAsync(10)));
      mockSensor.reading = { counter: 1600, elapsedMs: 2_000_000 };
      await act(async () => void (await jest.advanceTimersByTimeAsync(60_000))); // same day: no reading
      expect(await loadDayNote(db, DATE)).toBeNull();
      clock = new Date(2026, 9, 9, 0, 0, 30);
      await act(async () => void (await jest.advanceTimersByTimeAsync(60_000)));
      await waitFor(async () => expect(await loadDayNote(db, DATE)).toMatchObject({ steps: 600, steps_source: 'device' }));
    } finally {
      jest.useRealTimers();
    }
  });

  /** On with a baseline stored, then a reading that is still in flight; returns the db and a way to finish the read. */
  async function inFlight() {
    const db = await setup({ on: true });
    await waitFor(async () => expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).not.toBeNull());
    let release = () => {};
    mockSensor.gate = new Promise<void>((r) => (release = r));
    mockSensor.reading = { counter: 5000, elapsedMs: 3_000_000 };
    await act(async () => appState('active'));
    return { db, finish: () => act(async () => void release()) };
  }

  it('drops a reading that is still in flight when the toggle is turned off', async () => {
    const { db, finish } = await inFlight();
    await act(async () => void (await fireEvent(screen.getByLabelText(LABEL), 'valueChange', false)));
    await finish();
    await act(async () => void (await Promise.resolve()));
    expect(await loadDayNote(db, DATE)).toBeNull();
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).toBeNull();
  });

  it('drops a reading that is still in flight when the local store is wiped (sign-out, delete everything)', async () => {
    const { db, finish } = await inFlight();
    await wipeLocalStore(db, { force: true });
    await finish();
    await act(async () => void (await Promise.resolve()));
    expect(await loadDayNote(db, DATE)).toBeNull();
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'steps.device.baseline'")).toBeNull();
    expect(await loadStepsOn(db)).toBe(false);
  });
});
