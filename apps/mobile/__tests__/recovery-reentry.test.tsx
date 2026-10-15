import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { recoveryWeek, type LiftRecord } from '@plate-and-bar/core';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { buildSession } from '../src/workout/buildSession';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
// Thursday's 6-day plan session; Pull B (5 fresh names) is what the second-session chips offer.
const PUSH_B = ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension'];
type Db = ReturnType<typeof memoryDb>;
const settingsOf = (db: Db) => JSON.parse(db.rows.get('user_settings:me') as string) as Settings;

const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
const stalledLift = (): LiftRecord => ({ date: '2026-10-05', sets: [{ w: 40, r: 10, rate: 'right' }], form: 'yes', n: 5, first: '2026-09-01', prev: null, hist: [50, 60, 59, 59.5, 60].map((e, i) => ({ date: `2026-09-${10 + i}`, e })), pbToast: null });

async function open(adjustments: Record<string, unknown>, lifts: string[] = []) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments });
  for (const n of lifts) db.rows.set(`lift_stats:${n}`, JSON.stringify(stalledLift()));
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  return db;
}

/** The working-set rows the screen stored today for one exercise. */
const storedSets = (db: Db, name: string): number =>
  [...db.sets.values()].filter((s) => s.kind === 'work' && s.deleted === 0 && (JSON.parse(s.data) as { exercise: string }).exercise === name).length;

describe('buildSession with a recovery week or re-entry', () => {
  const base = { template: 'Push B', date: DATE, profile: profile(), where: 'gym' as const, sessions: {}, lifts: {}, ciChoice: null, checkin: {}, focus: [], exclusions: [], swaps: [] };
  const normal = buildSession({ ...base, adjustments: {} });

  it('a recovery week keeps about 60% of the sets (at least 2), as core says', () => {
    const b = buildSession({ ...base, adjustments: { deload: recoveryWeek(DATE) } });
    expect(b.mods.deload).toBe(true);
    expect(b.exercises.map((e) => e.sets)).toEqual(normal.exercises.map((e) => Math.min(e.sets, Math.max(2, Math.ceil(e.sets * 0.6)))));
  });

  it('a 30% re-entry stores the fraction and takes one set off; 15% only stores it', () => {
    const long = buildSession({ ...base, adjustments: { reentry: { from: DATE, until: '2026-10-21', pct: 0.3 } } });
    expect(long.mods.reentry).toBe(0.3);
    expect(long.exercises.map((e) => e.sets)).toEqual(normal.exercises.map((e) => Math.max(1, e.sets - 1)));
    const short = buildSession({ ...base, adjustments: { reentry: { from: DATE, until: '2026-10-14', pct: 0.15 } } });
    expect(short.mods.reentry).toBe(0.15);
    expect(short.exercises).toEqual(normal.exercises.map((e) => ({ ...e })));
  });

  it('an ended or malformed range counts as none', () => {
    expect(buildSession({ ...base, adjustments: { deload: { from: '2026-09-01', until: '2026-09-07' }, reentry: { until: 5 } } }).mods).toMatchObject({ deload: false, reentry: 0 });
  });

  it('a range whose until or from is not a YYYY-MM-DD date counts as none', () => {
    // A pulled `until` that is not a date never ends ('zzz' >= any date) and reads as "Invalid Date"; an array is not
    // a string at all but compares as one ('2026-10-21' >= DATE), so both have to be refused, not just non-strings.
    const none: Record<string, unknown>[] = [
      { deload: { until: 'zzz' } },
      { deload: { until: ['2026-10-21'] } },
      { reentry: { until: 'zzz', pct: 0.3 } },
      { reentry: { until: ['2026-10-21'], pct: 0.3 } },
      { reentry: { until: '21/10/2026', pct: 0.3 } },
      { reentry: { from: 'zzz', until: '2026-10-21', pct: 0.3 } },
      { reentry: { from: 20261008, until: '2026-10-21', pct: 0.3 } },
    ];
    for (const adjustments of none) expect(buildSession({ ...base, adjustments }).mods).toMatchObject({ deload: false, reentry: 0 });
  });

  it('a re-entry fraction outside 0 < pct <= 1 counts as none, keeping mods.reentry in the contract', () => {
    // The contract allows 0 to 1, and core eases the suggested weight by `1 - pct`: 5, a negative or 1e9 would fail
    // `/sync` and point the wrong way, so none of these may reach the stored mods.
    for (const pct of [5, -0.5, 0, 1e9, Number.NaN, Number.POSITIVE_INFINITY, '0.3', null, true]) {
      const b = buildSession({ ...base, adjustments: { reentry: { from: DATE, until: '2026-10-21', pct } } });
      expect(b.mods.reentry).toBe(0);
      expect(b.mods.reentry).toBeGreaterThanOrEqual(0);
      expect(b.mods.reentry).toBeLessThanOrEqual(1);
      expect(b.exercises.map((e) => e.sets)).toEqual(normal.exercises.map((e) => e.sets));
    }
  });

  it('keeps the largest fraction the contract allows (pct 1)', () => {
    const b = buildSession({ ...base, adjustments: { reentry: { from: DATE, until: '2026-10-21', pct: 1 } } });
    expect(b.mods.reentry).toBe(1);
    expect(b.exercises.map((e) => e.sets)).toEqual(normal.exercises.map((e) => Math.max(1, e.sets - 1)));
  });
});

describe('recovery week on the start screen', () => {
  it('shows the card for 3 stalled lifts, and Start recovery week stores 7 days and dismisses the card', async () => {
    const db = await open({}, ['Pec Deck Fly', 'Cable Lateral Raise', 'Machine Shoulder Press']);
    expect(await screen.findByText('Several lifts have stalled')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Start recovery week, recovery week'));
    await waitFor(() => expect(settingsOf(db).adjustments).toMatchObject({ deload: recoveryWeek(DATE), dismissed: { 'deload:2026-10-05': true } }));
    expect(await screen.findByText('Recovery week until 14 Oct.')).toBeTruthy();
    expect(screen.queryByText('Several lifts have stalled')).toBeNull();
  });

  it('Not now counts a decline', async () => {
    const db = await open({}, ['Pec Deck Fly', 'Cable Lateral Raise', 'Machine Shoulder Press']);
    fireEvent.press(await screen.findByLabelText('Not now, recovery week'));
    await waitFor(() => expect(settingsOf(db).adjustments).toMatchObject({ declines: { deload: 1 } }));
  });

  it('names 3 stalled lifts and counts the rest, and after 3 declines "Stop suggesting this" mutes the deload type', async () => {
    const db = await open({ declines: { deload: 3 } }, ['Pec Deck Fly', 'Cable Lateral Raise', 'Machine Shoulder Press', 'Machine Chest Press']);
    expect(await screen.findByText(/^Pec Deck Fly, Cable Lateral Raise, Machine Shoulder Press and 1 more haven’t moved in 3 sessions\./)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Stop suggesting this, recovery week'));
    await waitFor(() => expect(settingsOf(db).adjustments).toMatchObject({ muted: { deload: true } }));
    expect(screen.queryByText('Several lifts have stalled')).toBeNull();
  });

  it('a pulled recovery week whose until is not a date counts as none (no "until Invalid Date")', async () => {
    await open({ deload: { until: 'zzz' } });
    await screen.findByLabelText('Start Push B');
    expect(screen.queryByText(/Recovery week until/)).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('a running recovery week is noted on the session and can be ended early', async () => {
    const db = await open({ deload: recoveryWeek(DATE) });
    expect(await screen.findByText('Recovery week until 14 Oct.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('End it early'));
    await waitFor(() => expect(settingsOf(db).adjustments).not.toHaveProperty('deload'));
    expect(screen.queryByText(/Recovery week until/)).toBeNull();
  });

  it('starting a session in a recovery week stores deload and shows the Today note', async () => {
    const db = await open({ deload: recoveryWeek(DATE) });
    fireEvent.press(await screen.findByLabelText('Start Push B'));
    expect(await screen.findByText(/Today: recovery week: fewer sets, about 10% lighter/)).toBeTruthy();
    await waitFor(() => expect(JSON.parse(db.rows.get(`workouts:${DATE}`) as string).mods.deload).toBe(true));
  });

  it('a second session added in a recovery week keeps the reduced set counts', async () => {
    const db = await open({ deload: recoveryWeek(DATE) }, PUSH_B);
    const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
    await press('Start Push B');
    await screen.findByText('Push B');
    for (const n of PUSH_B) await press(`Mark ${n} set 1 done`);
    await press('Training again later today?');
    await press('Add Pull B');
    await waitFor(() => expect(JSON.parse(db.rows.get(`workouts:${DATE}`) as string).template).toBe('Push B + Pull B'));
    // Core's numbers for the same second session, with the recovery week on and off: the added exercises keep the
    // reduced counts, and the two differ (so this test would catch the second session being built without them).
    const second = (adjustments: Record<string, unknown>) =>
      buildSession({ template: 'Pull B', date: DATE, profile: profile(), where: 'gym', sessions: {}, lifts: {}, ciChoice: null, checkin: {}, focus: [], exclusions: [], swaps: [], adjustments });
    const reduced = second({ deload: recoveryWeek(DATE) });
    const plain = second({});
    expect(reduced.exercises.map((e) => e.sets)).not.toEqual(plain.exercises.map((e) => e.sets));
    for (const e of reduced.exercises) expect(storedSets(db, e.name)).toBe(e.sets);
  });
});

describe('re-entry on the start screen', () => {
  it('a running period is noted and shows in the session', async () => {
    const db = await open({ reentry: { from: DATE, until: '2026-10-21', pct: 0.3 } });
    expect(await screen.findByText('Easing back in until 21 Oct.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Start Push B'));
    expect(await screen.findByText(/Today: easing back in: about 30% lighter/)).toBeTruthy();
    expect(settingsOf(db).adjustments).toHaveProperty('reentry');
  });

  it('Back to normal removes the period', async () => {
    const db = await open({ reentry: { from: DATE, until: '2026-10-21', pct: 0.3 } });
    fireEvent.press(await screen.findByLabelText('Back to normal'));
    await waitFor(() => expect(settingsOf(db).adjustments).not.toHaveProperty('reentry'));
  });

  it('a pulled period whose until or pct is malformed counts as none', async () => {
    await open({ reentry: { until: ['2026-10-21'], pct: 0.3 } });
    await screen.findByLabelText('Start Push B');
    expect(screen.queryByText(/Easing back in/)).toBeNull();
  });
});
