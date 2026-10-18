import { AccessibilityInfo, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const TODAY = '2026-10-08';
const YESTERDAY = '2026-10-07';

const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
async function setup() {
  const db = memoryDb();
  await saveProfile(db, profile());
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  await screen.findByLabelText('Start Push B');
  return db;
}
const back = async () => fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
const forward = async () => fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
const stored = <T,>(db: Db, key: string) => JSON.parse(db.rows.get(key) as string) as T;
const storedSets = (db: Db) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);
/** Starts the first session offered on the day shown; returns its template. */
async function startFirst(): Promise<string> {
  const btn = (await screen.findAllByLabelText(/^Start /))[0]!;
  const label = btn.props.accessibilityLabel as string;
  await fireEvent.press(btn);
  await screen.findByText(label.replace('Start ', ''));
  return label.replace('Start ', '');
}

describe('Workout date navigation', () => {
  it('shows Today, then Yesterday, with next off at today', async () => {
    await setup();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' }).props.accessibilityState).toMatchObject({ disabled: true });
    await back();
    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Wednesday, 7 Oct')).toBeTruthy();
    await forward();
    expect(await screen.findByText('Today')).toBeTruthy();
    expect(screen.getByLabelText('Start Push B')).toBeTruthy();
  });

  it('plans the viewed day, not today', async () => {
    await setup();
    await back();
    await screen.findByText('Yesterday');
    // Thursday's plan leads with Push B; Wednesday's leads with Legs A (Push B is only an alternative there).
    expect(screen.getAllByLabelText(/^Start /)[0]!.props.accessibilityLabel).toBe('Start Legs A');
    expect(screen.getByText('Legs A day')).toBeTruthy();
  });

  it('Start, a set tick and the lift stat on a past day write that date, and are there after a reload', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    const template = await startFirst();
    expect(stored<Workout>(db, `workouts:${YESTERDAY}`)).toMatchObject({ date: YESTERDAY, template });
    expect(db.rows.has(`workouts:${TODAY}`)).toBe(false);
    const first = stored<Workout>(db, `workouts:${YESTERDAY}`).exercises[0]!.name;
    const kg = screen.queryByLabelText(`${first} set 1 kg`);
    if (kg) await fireEvent.changeText(kg, '10');
    await fireEvent.changeText(screen.getByLabelText(`${first} set 1 reps`), '10');
    await fireEvent.press(screen.getByLabelText(`Mark ${first} set 1 done`));
    await waitFor(() => expect(storedSets(db).some((s) => s.done)).toBe(true));
    expect(JSON.parse(db.rows.get(`lift_stats:${first}`) as string).date).toBe(YESTERDAY);

    await screen.unmount();
    await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
    await screen.findByLabelText('Start Push B'); // a reload shows today, still without a session
    await back();
    expect(await screen.findByText(template)).toBeTruthy();
    expect(screen.getByLabelText(`Mark ${first} set 1 done`).props.accessibilityState.checked).toBe(true);
    await forward();
    expect(await screen.findByLabelText('Start Push B')).toBeTruthy();
  });

  it('shows Loading, not the other day’s session, while a day is read', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    await startFirst(); // yesterday has a session; today has none
    const read = db.getFirstAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM workouts')) await gate;
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    await forward();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText(/^Mark .* set 1 done$/)).toBeNull();
    expect(screen.getByText('Today')).toBeTruthy();
    await act(async () => open());
    expect(await screen.findByLabelText('Start Push B')).toBeTruthy();
  });
  it('keeps a running rest timer and a message on screen while a day is read', async () => {
    const db = await setup();
    await startFirst(); // today
    const first = screen.getAllByLabelText(/^Mark .* set 1 done$/)[0]!.props.accessibilityLabel as string;
    const name = first.replace(/^Mark /, '').replace(/ set 1 done$/, '');
    await fireEvent.press(screen.getByLabelText(first)); // nothing entered yet: a message
    expect(await screen.findByText(/^Enter the .* first\.$/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(`${name} set 1 reps`), '10');
    const kg = screen.queryByLabelText(`${name} set 1 kg`);
    if (kg) await fireEvent.changeText(kg, '10');
    await fireEvent.press(screen.getByLabelText(first)); // a set done: the rest timer starts
    expect(await screen.findByLabelText('Rest timer')).toBeTruthy();
    const read = db.getFirstAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM workouts')) await gate;
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    await back();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByLabelText('Rest timer')).toBeTruthy();
    expect(screen.getByText(/^Enter the .* first\.$/)).toBeTruthy();
    await act(async () => open());
    await screen.findByText('Yesterday');
    expect(screen.getByLabelText('Rest timer')).toBeTruthy();
  });

  describe('rest bar and toast across a day change', () => {
    const os = Platform.OS;
    afterEach(() => {
      Platform.OS = os;
      jest.restoreAllMocks();
    });
    /** Starts today's session, shows a message and starts a rest; then holds the day read and goes back a day. Returns the release. */
    async function restAndToast(db: Db) {
      await startFirst();
      const first = screen.getAllByLabelText(/^Mark .* set 1 done$/)[0]!.props.accessibilityLabel as string;
      const name = first.replace(/^Mark /, '').replace(/ set 1 done$/, '');
      await fireEvent.press(screen.getByLabelText(first));
      await screen.findByText(/^Enter the .* first\.$/);
      await fireEvent.changeText(screen.getByLabelText(`${name} set 1 reps`), '10');
      const kg = screen.queryByLabelText(`${name} set 1 kg`);
      if (kg) await fireEvent.changeText(kg, '10');
      await fireEvent.press(screen.getByLabelText(first));
      await screen.findByLabelText('Rest timer');
      const read = db.getFirstAsync.bind(db);
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('FROM workouts')) await gate;
        return read(sql, ...p);
      }) as typeof db.getFirstAsync;
      await back();
      expect(screen.getByText('Loading…')).toBeTruthy();
      return open;
    }

    it('on iOS, "Rest done, go!" is announced once when the timer ends, not again on a day change', async () => {
      Platform.OS = 'ios';
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear();
      const db = await setup();
      const realNow = Date.now();
      const open0 = await restAndToast(db);
      const rests = () => announce.mock.calls.filter(([t]) => t === 'Rest done, go!').length;
      expect(rests()).toBe(0);
      jest.spyOn(Date, 'now').mockReturnValue(realNow + 60 * 60 * 1000); // the rest has run out
      await waitFor(() => expect(rests()).toBe(1));
      await act(async () => open0());
      await screen.findByText('Yesterday');
      await forward();
      await screen.findByText('Today');
      expect(rests()).toBe(1);
    });

    it('on web, the toast node is the same one across the day read, so it is not read again', async () => {
      Platform.OS = 'web';
      const db = await setup();
      const open = await restAndToast(db);
      const toast = screen.getByText(/^Enter the .* first\.$/);
      await act(async () => open());
      await screen.findByText('Yesterday');
      expect(screen.getByText(/^Enter the .* first\.$/)).toBe(toast);
    });
  });

  describe('announcement', () => {
    const originalOS = Platform.OS;
    afterEach(() => {
      Platform.OS = originalOS;
    });
    const slowWorkouts = (db: Db) => {
      const read = db.getFirstAsync.bind(db);
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('FROM workouts')) await gate;
        return read(sql, ...p);
      }) as typeof db.getFirstAsync;
      return open;
    };

    it('on iOS, announces once per change and not on the first show; the live region stays empty', async () => {
      Platform.OS = 'ios';
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear();
      const db = await setup();
      expect(announce).not.toHaveBeenCalled();
      const open = slowWorkouts(db);
      await back();
      await act(async () => open());
      await screen.findByText('Wednesday, 7 Oct');
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Yesterday, Wednesday, 7 Oct');
      expect(screen.getByTestId('date-announce')).toHaveTextContent('');
      announce.mockRestore();
    });

    it.each(['android', 'web'] as const)('on %s, one polite live region outside the loading swap says it once', async (os) => {
      Platform.OS = os;
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear();
      const db = await setup();
      const region = screen.getByTestId('date-announce');
      expect(region).toHaveTextContent('');
      const open = slowWorkouts(db);
      await back();
      expect(screen.getByText('Loading…')).toBeTruthy();
      await act(async () => open());
      await screen.findByText('Wednesday, 7 Oct');
      expect(screen.getAllByTestId('date-announce')).toHaveLength(1);
      expect(screen.getByTestId('date-announce')).toBe(region);
      expect(screen.getByTestId('date-announce')).toHaveTextContent('Yesterday, Wednesday, 7 Oct');
      expect(announce).not.toHaveBeenCalled();
      announce.mockRestore();
    });

    it('a session screen keeps the same single region too', async () => {
      Platform.OS = 'android';
      await setup();
      await back();
      await screen.findByText('Yesterday');
      const region = screen.getByTestId('date-announce');
      await startFirst();
      expect(screen.getAllByTestId('date-announce')).toHaveLength(1);
      expect(screen.getByTestId('date-announce')).toBe(region);
    });
  });
  describe('cards on a past day', () => {
    const seedSession = (db: Db, date: string) => {
      db.rows.set(`workouts:${date}`, JSON.stringify({ date, base: 'Push B', template: 'Push B', deleted_at: null }));
      for (let i = 0; i < 3; i++) db.sets.set(`${date}-${i}`, { date, kind: 'work', done: 1, deleted: 0, data: '{}' });
    };
    const settingsOf = (db: Db) => JSON.parse(db.rows.get('user_settings:me') as string) as Settings;
    const open = async () => {
      const db = memoryDb();
      await saveProfile(db, profile());
      // 9 Jul is before the 90-day window from the real today (8 Oct: window starts 10 Jul) but inside it from the viewed day (7 Oct: starts 9 Jul).
      await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments: { dismissed: { 'break:2026-07-09': true, 'break:2026-07-13': true } } });
      seedSession(db, '2026-09-23'); // 15 days before today, 14 before yesterday
      await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
      return db;
    };

    it('the break is counted from the viewed day, as the prototype counts from S.date', async () => {
      await open();
      expect(await screen.findByText('Welcome back. It’s been 15 days.')).toBeTruthy();
      await back();
      expect(await screen.findByText('Welcome back. It’s been 14 days.')).toBeTruthy();
    });

    it('Ease back in on a past day starts the range at that day, keys the card by its last session, and prunes by the real date', async () => {
      const db = await open();
      await screen.findByText('Welcome back. It’s been 15 days.');
      await back();
      await screen.findByText('Welcome back. It’s been 14 days.');
      await fireEvent.press(screen.getByLabelText('Ease back in, re-entry'));
      await waitFor(() => expect(settingsOf(db).adjustments).toEqual({ reentry: { from: YESTERDAY, until: '2026-10-13', pct: 0.15 }, dismissed: { 'break:2026-07-13': true, 'break:2026-09-23': true } }));
    });
  });
  it('a Start still reading history when the day changes does not put its session on the new day', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    const read = db.getAllAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('GROUP BY workout_date')) await gate;
      return read(sql, ...p);
    }) as typeof db.getAllAsync;
    const btn = (await screen.findAllByLabelText(/^Start /))[0]!;
    await fireEvent.press(btn); // reading history, nothing built yet
    await forward();
    await act(async () => open());
    expect(await screen.findByLabelText('Start Push B')).toBeTruthy(); // today, still with no session
    expect(screen.queryByLabelText(/^Mark .* set 1 done$/)).toBeNull();
    expect(db.rows.has(`workouts:${YESTERDAY}`)).toBe(false);
    expect(db.rows.has(`workouts:${TODAY}`)).toBe(false);
  });
  it('a second session still reading history when the day changes is not added to the new day', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    await fireEvent.press(screen.getByLabelText('Choose Push B'));
    await fireEvent.press(screen.getByLabelText('Start Push B'));
    await screen.findAllByLabelText(/^Mark .* set 1 done$/);
    const template = 'Push B';
    for (const n of stored<Workout>(db, `workouts:${YESTERDAY}`).exercises.map((e) => e.name)) {
      const kg = screen.queryByLabelText(`${n} set 1 kg`);
      if (kg) await fireEvent.changeText(kg, '10');
      await fireEvent.changeText(screen.getByLabelText(`${n} set 1 reps`), '10');
      await fireEvent.press(screen.getByLabelText(`Mark ${n} set 1 done`));
    }
    await fireEvent.press(screen.getByLabelText('Training again later today?'));
    const before = stored<Workout>(db, `workouts:${YESTERDAY}`).exercises.length;
    const read = db.getAllAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('GROUP BY workout_date')) await gate;
      return read(sql, ...p);
    }) as typeof db.getAllAsync;
    await fireEvent.press(screen.getByLabelText('Add Pull B'));
    await forward();
    await act(async () => open());
    expect(await screen.findByLabelText('Start Push B')).toBeTruthy();
    expect(screen.queryByLabelText(/^Mark .* set 1 done$/)).toBeNull();
    expect(stored<Workout>(db, `workouts:${YESTERDAY}`)).toMatchObject({ template });
    expect(stored<Workout>(db, `workouts:${YESTERDAY}`).exercises.length).toBe(before);
    expect(db.rows.has(`workouts:${TODAY}`)).toBe(false);
  });
});
