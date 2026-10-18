import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { saveWeight } from '../src/db/progress';
import { saveCycle } from '../src/db/cycle';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

const mockFocus = { n: 0 };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [mockFocus.n]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // 8 Oct 2026
const WATER_NOTE = /Water retention is common around now/;
const CHECKIN_NOTE = /This is the part of your cycle when water retention is common, so read the scale loosely\./;

function profile(sex: 'male' | 'female') {
  return buildProfile(
    { ...emptyDraft(), sex, age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}
type Db = ReturnType<typeof memoryDb>;
async function setup(opts: { sex?: 'male' | 'female'; cycle?: { on: boolean; starts: string[]; len?: number } } = {}) {
  const db = memoryDb();
  await saveProfile(db, profile(opts.sex ?? 'female'));
  if (opts.cycle) await saveCycle(db, { len: 28, ...opts.cycle });
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}
const stored = (db: Db) => (db.rows.has('cycle_log:me') ? JSON.parse(db.rows.get('cycle_log:me')!) : null);
const syncedTables = (db: Db) => [...db.rows.keys()].filter((k) => k.startsWith('cycle_log:'));

beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('Cycle log section', () => {
  it('offers the optional log to women with the prototype copy, and stores nothing until turned on', async () => {
    const db = await setup();
    expect(await screen.findByRole('header', { name: 'Cycle log' })).toBeTruthy();
    expect(screen.getByText(/Optional\. Water retention around your period can move the scale by a kilo or more; tracking it lets the app compare like with like\. Kept only on this device\./)).toBeTruthy();
    expect(stored(db)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Log the first day of your period to start.')).toBeTruthy();
    expect(stored(db)).toEqual({ on: true, starts: [], len: 28 });
  });

  it('shows nothing to men, or to anyone else who has not turned it on', async () => {
    await setup({ sex: 'male' });
    expect(screen.queryByRole('header', { name: 'Cycle log' })).toBeNull();
  });

  it('shows the log to a man who has it on', async () => {
    await setup({ sex: 'male', cycle: { on: true, starts: [] } });
    expect(await screen.findByRole('header', { name: 'Cycle log' })).toBeTruthy();
  });

  it('logs a period start: Day N of about L, the phase, the list, and a Logged toast', async () => {
    const db = await setup({ cycle: { on: true, starts: [] } });
    await screen.findByText('Log the first day of your period to start.');
    await fireEvent.changeText(screen.getByLabelText('Date your period started'), '2026-09-25');
    await fireEvent.press(screen.getByRole('button', { name: 'Period started' }));
    expect(await screen.findByLabelText('Day 14 of about 28, around ovulation.')).toBeTruthy(); // 25 Sep to 8 Oct
    expect(screen.getByText('Logged')).toBeTruthy();
    expect(screen.getByText('Logged: 25 Sept.')).toBeTruthy();
    expect(stored(db)).toEqual({ on: true, starts: ['2026-09-25'], len: 28 });
  });

  it('day 14 of a 28-day cycle reads "around ovulation" and shows no water note', async () => {
    await setup({ cycle: { on: true, starts: ['2026-09-25'] } });
    expect(await screen.findByLabelText('Day 14 of about 28, around ovulation.')).toBeTruthy();
    expect(screen.queryByText(WATER_NOTE)).toBeNull();
    expect(screen.getByText('Logged: 25 Sept.')).toBeTruthy();
  });

  it('refuses a date that is not a real day or is in the future, and writes nothing', async () => {
    const db = await setup({ cycle: { on: true, starts: [] } });
    await screen.findByText('Log the first day of your period to start.');
    for (const bad of ['2026-02-30', '2026-10-09', 'yesterday', '']) {
      await fireEvent.changeText(screen.getByLabelText('Date your period started'), bad);
      await fireEvent.press(screen.getByRole('button', { name: 'Period started' }));
      expect(await screen.findByText('Enter the date as YYYY-MM-DD, today or earlier.')).toBeTruthy();
    }
    expect(stored(db)).toEqual({ on: true, starts: [], len: 28 });
  });

  it('in the luteal phase it shows the water-retention note and, once, "Same day last cycle" with that day\'s weight', async () => {
    const db = memoryDb();
    await saveProfile(db, profile('female'));
    await saveCycle(db, { on: true, starts: ['2026-09-12', '2026-10-01'], len: 28 }); // 8 Oct is day 8 of a 19-day cycle: luteal
    await saveWeight(db, { id: null, version: 0, updated_at: '2026-09-19T00:00:00Z', deleted_at: null, date: '2026-09-19', weight_kg: 81.24 });
    await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
    expect(await screen.findByLabelText('Day 8 of about 19, luteal (before your period).')).toBeTruthy();
    expect(screen.getByText(WATER_NOTE)).toBeTruthy();
    expect(screen.getByText('Same day last cycle (19 Sept): 81.2 kg.')).toBeTruthy();
  });

  it('says the period seems late, in the same place the prototype does', async () => {
    await setup({ cycle: { on: true, starts: ['2026-08-20'] } }); // day 50 of 28
    expect(await screen.findByText('Your period seems later than usual. Log it when it starts.')).toBeTruthy();
  });

  it('Remove last drops the latest start', async () => {
    const db = await setup({ cycle: { on: true, starts: ['2026-08-27', '2026-09-24'] } });
    await screen.findByText('Logged: 27 Aug, 24 Sept.');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove last' }));
    expect(await screen.findByText('Logged: 27 Aug.')).toBeTruthy();
    expect(stored(db)?.starts).toEqual(['2026-08-27']);
  });

  it('Turn off and delete takes a second tap: the first only arms it and nothing is deleted', async () => {
    const db = await setup({ cycle: { on: true, starts: ['2026-09-24'] } });
    await screen.findByText(/Kept only on this device, never uploaded\./);
    await fireEvent.press(screen.getByRole('button', { name: 'Turn off and delete' }));
    expect(await screen.findByRole('button', { name: 'Tap again to delete the cycle log' })).toBeTruthy();
    expect(stored(db)).toEqual({ on: true, starts: ['2026-09-24'], len: 28 });
    expect(screen.queryByText('Cycle log deleted')).toBeNull();
  });

  it('the second tap removes the stored log entirely and says so', async () => {
    const db = await setup({ cycle: { on: true, starts: ['2026-09-24'] } });
    await screen.findByText(/Kept only on this device, never uploaded\./);
    await fireEvent.press(screen.getByRole('button', { name: 'Turn off and delete' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Tap again to delete the cycle log' }));
    expect(await screen.findByText('Cycle log deleted')).toBeTruthy();
    expect(stored(db)).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy();
  });

  it('the armed button disarms after 4 seconds, so a late stray tap deletes nothing', async () => {
    const db = await setup({ cycle: { on: true, starts: ['2026-09-24'] } });
    await screen.findByText(/Kept only on this device, never uploaded\./);
    await fireEvent.press(screen.getByRole('button', { name: 'Turn off and delete' }));
    await screen.findByRole('button', { name: 'Tap again to delete the cycle log' });
    await act(async () => void jest.advanceTimersByTime(4100));
    expect(screen.getByRole('button', { name: 'Turn off and delete' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn off and delete' }));
    expect(stored(db)?.starts).toEqual(['2026-09-24']);
  });

  it('the date field uses a keyboard that can type a dash, not a numeric pad', async () => {
    await setup({ cycle: { on: true, starts: [] } });
    const field = await screen.findByLabelText('Date your period started');
    expect(field.props.inputMode ?? 'text').toBe('text');
    expect(['numeric', 'number-pad', 'decimal-pad', 'phone-pad']).not.toContain(field.props.keyboardType);
    expect(field.props.placeholder).toBe('YYYY-MM-DD');
  });

  it('a log wiped while Progress is shown is not written back: logging then stores nothing and the section shows it is off', async () => {
    const db = await setup({ cycle: { on: true, starts: ['2026-09-12', '2026-10-01'] } });
    await screen.findByLabelText(/^Day 8 of about 19/);
    db.rows.delete('cycle_log:me'); // sign-out or delete everything ran meanwhile; no sync, no focus change
    await fireEvent.changeText(screen.getByLabelText('Date your period started'), '2026-10-06');
    await fireEvent.press(screen.getByRole('button', { name: 'Period started' }));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(stored(db)).toBeNull();
  });

  it('Remove last after a wipe does not bring the old starts back either', async () => {
    const db = await setup({ cycle: { on: true, starts: ['2026-09-12', '2026-10-01'] } });
    await screen.findByText('Logged: 12 Sept, 1 Oct.');
    db.rows.delete('cycle_log:me');
    await fireEvent.press(screen.getByRole('button', { name: 'Remove last' }));
    await screen.findByRole('button', { name: 'Turn on' });
    expect(stored(db)).toBeNull();
  });

  it('reads the log again when sync bumps dataVersion, so a wipe shows at once', async () => {
    const db = memoryDb();
    await saveProfile(db, profile('female'));
    await saveCycle(db, { on: true, starts: ['2026-09-25'], len: 28 });
    const at = (dataVersion: number) => <SyncContext.Provider value={{ dataVersion } as SyncState}>{withProfile(db, <ProgressScreen db={db} now={NOW} />)}</SyncContext.Provider>;
    const view = await render(at(0));
    await screen.findByLabelText('Day 14 of about 28, around ovulation.');
    db.rows.delete('cycle_log:me');
    await view.rerender(at(1));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(screen.queryByLabelText(/^Day 14/)).toBeNull();
  });

  it('two quick taps both count', async () => {
    const db = await setup({ cycle: { on: true, starts: [] } });
    await screen.findByText('Log the first day of your period to start.');
    await fireEvent.changeText(screen.getByLabelText('Date your period started'), '2026-09-10');
    await fireEvent.press(screen.getByRole('button', { name: 'Period started' }));
    await fireEvent.changeText(screen.getByLabelText('Date your period started'), '2026-10-01');
    await fireEvent.press(screen.getByRole('button', { name: 'Period started' }));
    await waitFor(() => expect(stored(db)?.starts).toEqual(['2026-09-10', '2026-10-01']));
  });

  it('a failed save puts the screen back and says so', async () => {
    const db = await setup();
    db.failWrites = true;
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Couldn’t save the cycle log. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy();
  });

  it('writes only to its own table', async () => {
    const db = await setup({ cycle: { on: true, starts: [] } });
    await screen.findByText('Log the first day of your period to start.');
    await fireEvent.changeText(screen.getByLabelText('Date your period started'), '2026-10-01');
    await fireEvent.press(screen.getByRole('button', { name: 'Period started' }));
    await waitFor(() => expect(stored(db)?.starts).toEqual(['2026-10-01']));
    expect([...db.rows.keys()].filter((k) => !k.startsWith('profiles:') && !k.startsWith('settings:') && !k.startsWith('user_settings:'))).toEqual(syncedTables(db));
  });
});

describe('Check-in phase line', () => {
  const weekly = /Weight: log at least 3 weigh-ins a week to see your weekly trend\./;
  it('adds the water-retention sentence to the weight line in the luteal phase', async () => {
    await setup({ cycle: { on: true, starts: ['2026-09-12', '2026-10-01'] } });
    expect(await screen.findByText(new RegExp(`${weekly.source} ${CHECKIN_NOTE.source}`))).toBeTruthy();
  });
  it('in the period phase too', async () => {
    await setup({ cycle: { on: true, starts: ['2026-10-06'] } });
    expect(await screen.findByText(CHECKIN_NOTE)).toBeTruthy();
  });
  it('not in the follicular or ovulation phase, with the log off, or with no log', async () => {
    await setup({ cycle: { on: true, starts: ['2026-09-25'] } });
    await screen.findByLabelText('Day 14 of about 28, around ovulation.');
    expect(screen.queryByText(CHECKIN_NOTE)).toBeNull();
    expect(screen.getByText(weekly)).toBeTruthy();
  });
  it('not when the log is off, even with starts stored', async () => {
    await setup({ cycle: { on: false, starts: ['2026-10-06'] } });
    await screen.findByText(weekly);
    expect(screen.queryByText(CHECKIN_NOTE)).toBeNull();
  });
  it('follows the day being viewed: a day before the period started has no note', async () => {
    await setup({ cycle: { on: true, starts: ['2026-10-06'] } });
    await screen.findByText(CHECKIN_NOTE);
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByLabelText('Previous day')); // 5 Oct, before the 6 Oct start
    await waitFor(() => expect(screen.queryByText(CHECKIN_NOTE)).toBeNull());
  });
});
