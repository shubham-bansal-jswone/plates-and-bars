import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { LiftRecord } from '@plate-and-bar/core';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveSet, saveWorkout } from '../src/db/workouts';
import { blankRow, setRecord } from '../src/workout/model';
import type { Workout } from '../src/workout/types';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings, type Settings } from '../src/settings/types';
import { saveExclusion, saveSwap, type ExclusionRecord } from '../src/db/rules';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

// Thursday 2026-10-08, Push B: Barbell Bench Press, Machine Shoulder Press, Pec Deck Fly, Cable Lateral Raise, Overhead Cable Extension.
const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const LAST = '2026-10-05';

type Db = ReturnType<typeof memoryDb>;
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));
const stored = <T,>(db: Db, key: string) => JSON.parse(db.rows.get(key) as string) as T;
const settingsOf = (db: Db) => stored<Settings>(db, 'user_settings:me');

function profile() {
  return buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}

const set = (r: number, rate: 'right' | 'fail' = 'right') => ({ w: 40, r, rate });
function lift(o: Partial<LiftRecord> = {}): LiftRecord {
  return { date: LAST, sets: [set(15), set(15), set(15)], form: 'yes', n: 5, first: '2026-09-01', prev: null, hist: [{ date: LAST, e: 60 }], pbToast: null, ...o };
}
const seed = (db: Db, name: string, rec: LiftRecord): void => void db.rows.set(`lift_stats:${name}`, JSON.stringify(rec));

async function openSession(prep?: (db: Db) => Promise<void> | void) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await prep?.(db);
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  return db;
}
async function started(prep?: (db: Db) => Promise<void> | void) {
  const db = await openSession(prep);
  await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
  await screen.findByText('Push B');
  return db;
}
const ended = (o: Partial<ExclusionRecord> = {}): ExclusionRecord => ({
  id: 'r1', version: 0, updated_at: '2026-09-01T00:00:00Z', deleted_at: null, name: 'Pec Deck Fly', scope: 'exercise', key: 'Pec Deck Fly', reason: 'dislike', created: '2026-09-10', until: '2026-10-08', to: { 'Pec Deck Fly': null }, done: false, ...o,
});

describe('re-check card for a timed rule that ended', () => {
  it('shows on the start screen, and the exercise stays out until it is answered', async () => {
    await openSession((db) => saveExclusion(db, ended()));
    expect(await screen.findByText('Ready to try Pec Deck Fly again?')).toBeTruthy();
    expect(screen.queryByLabelText(/Exercise \d: Pec Deck Fly/)).toBeNull();
    expect(screen.getByText(/You’ll start at about 55% of your old weight for 2 weeks, then build back up\./)).toBeTruthy();
  });

  it('does not show before the check-again day', async () => {
    await openSession((db) => saveExclusion(db, ended({ until: '2026-10-09' })));
    await screen.findByText('Push B day');
    expect(screen.queryByText(/again\?/)).toBeNull();
  });

  it('pain adds the physio line', async () => {
    await openSession((db) => saveExclusion(db, ended({ reason: 'pain' })));
    expect(await screen.findByText(/get your physio’s go-ahead first/)).toBeTruthy();
  });

  it('Try it again: the rule is done, and covered exercises with history start light', async () => {
    const db = await openSession(async (d) => {
      await saveExclusion(d, ended());
      seed(d, 'Pec Deck Fly', lift());
    });
    await press('Try it again, Pec Deck Fly');
    await waitFor(() => expect(screen.queryByText('Ready to try Pec Deck Fly again?')).toBeNull());
    expect(stored<ExclusionRecord>(db, 'exclusions:r1')).toMatchObject({ done: true });
    await waitFor(() => expect(settingsOf(db).returning).toEqual({ 'Pec Deck Fly': { until: '2026-10-21' } }));
    expect(await screen.findByLabelText('Exercise 3: Pec Deck Fly')).toBeTruthy();
    expect(screen.getByText('Welcome back to it. Start light.')).toBeTruthy();
  });

  it('2 more weeks moves the date; Keep it out makes it permanent', async () => {
    const db = await openSession((d) => saveExclusion(d, ended()));
    await press('2 more weeks, Pec Deck Fly');
    await waitFor(() => expect(stored<ExclusionRecord>(db, 'exclusions:r1').until).toBe('2026-10-22'));
    expect(screen.queryByText(/again\?/)).toBeNull();

    const db2 = memoryDb();
    await saveProfile(db2, profile());
    await saveExclusion(db2, ended());
    await render(withProfile(db2, <WorkoutScreen db={db2} now={THURSDAY} />));
    await press('Keep it out, Pec Deck Fly');
    await waitFor(() => expect(stored<ExclusionRecord>(db2, 'exclusions:r1').until).toBeNull());
  });
});

describe('ladder cards', () => {
  it('step up: saves a swap with a 14-day bridge and dismisses the card', async () => {
    const db = await started((d) => seed(d, 'Machine Shoulder Press', lift({ sets: [set(15), set(15), set(15)] })));
    expect(await screen.findByText('Ready to try Seated Dumbbell Press?')).toBeTruthy();
    expect(screen.getByText(/done Machine Shoulder Press for 5 sessions/)).toBeTruthy();
    await press('Try it next session, Machine Shoulder Press');
    await waitFor(() => expect(db.rows.get('swaps:Machine Shoulder Press')).toBeDefined());
    expect(stored(db, 'swaps:Machine Shoulder Press')).toMatchObject({ from: 'Machine Shoulder Press', to: 'Seated Dumbbell Press', since: DATE, bridge_until: '2026-10-21', deleted_at: null });
    expect(screen.queryByText('Ready to try Seated Dumbbell Press?')).toBeNull();
    expect(screen.getByText('Seated Dumbbell Press starts next session')).toBeTruthy();
    await waitFor(() => expect(settingsOf(db).adjustments).toMatchObject({ dismissed: { [`up:Machine Shoulder Press:${LAST}`]: true } }));
  });

  it('Stay on this step hides the card for 42 days', async () => {
    const db = await started((d) => seed(d, 'Machine Shoulder Press', lift()));
    await press('Stay on this step, Machine Shoulder Press');
    await waitFor(() => expect(settingsOf(db).ladder_stay).toEqual({ 'Machine Shoulder Press': '2026-11-19' }));
    expect(screen.queryByText('Ready to try Seated Dumbbell Press?')).toBeNull();
  });

  it('Not yet counts a decline; after three the card offers to stop, and that turns the card off', async () => {
    const db = await started(async (d) => {
      seed(d, 'Machine Shoulder Press', lift());
      await saveSettings(d, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments: { declines: { ladder: 2 } } });
    });
    expect(screen.queryByLabelText('Stop suggesting this, Machine Shoulder Press')).toBeNull();
    await press('Not yet, Machine Shoulder Press');
    await waitFor(() => expect(settingsOf(db).adjustments).toMatchObject({ declines: { ladder: 3 }, dismissed: { [`up:Machine Shoulder Press:${LAST}`]: true } }));

    const db2 = await started(async (d) => {
      seed(d, 'Machine Shoulder Press', lift());
      await saveSettings(d, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments: { declines: { ladder: 3 } } });
    });
    await press('Stop suggesting this, Machine Shoulder Press');
    await waitFor(() => expect(settingsOf(db2).adjustments).toMatchObject({ muted: { ladder: true } }));
    expect(screen.queryByText('Ready to try Seated Dumbbell Press?')).toBeNull();
  });

  it('step down after two bad sessions: switches with no bridge', async () => {
    const db = await started((d) => seed(d, 'Barbell Bench Press', lift({ form: 'no', prev: { date: '2026-09-28', sets: [set(6, 'fail')], form: 'no' } as LiftRecord['prev'] })));
    expect(await screen.findByText('Step down to Dumbbell Bench Press for a few weeks?')).toBeTruthy();
    expect(screen.getByText(/form breaking down/)).toBeTruthy();
    await press('Switch to Dumbbell Bench Press, Barbell Bench Press');
    await waitFor(() => expect(db.rows.get('swaps:Barbell Bench Press')).toBeDefined());
    expect(stored(db, 'swaps:Barbell Bench Press')).toMatchObject({ to: 'Dumbbell Bench Press', since: DATE, bridge_until: null });
  });
});

describe('stall card', () => {
  const stalledLift = () => lift({ sets: [set(10)], hist: [50, 60, 59, 59.5, 60].map((e, i) => ({ date: `2026-09-${10 + i}`, e })) });

  it('Switch to 6–8 writes the exercise’s override and the card’s range changes', async () => {
    const db = await started((d) => seed(d, 'Pec Deck Fly', stalledLift()));
    expect(await screen.findByText('No progress in 3 sessions')).toBeTruthy();
    expect(screen.getByText(/Try a heavier rep range for the next few weeks: 6–8 reps\./)).toBeTruthy();
    await press('Switch to 6–8, Pec Deck Fly');
    await waitFor(() => expect(settingsOf(db).exercise_overrides['Pec Deck Fly']).toMatchObject({ type: 'machine', rep_low: 6, rep_high: 8 }));
    expect(screen.getByText('Pec Deck Fly: now 6–8 reps')).toBeTruthy();
    expect(screen.queryByText('No progress in 3 sessions')).toBeNull();
    expect(screen.getByText(/Machine, 6–8 reps/)).toBeTruthy();
  });

  it('Or switch to a similar exercise saves a swap with no bridge', async () => {
    const db = await started((d) => seed(d, 'Cable Lateral Raise', stalledLift()));
    await press('Or switch to Lateral Raise, Cable Lateral Raise');
    await waitFor(() => expect(db.rows.get('swaps:Cable Lateral Raise')).toBeDefined());
    expect(stored(db, 'swaps:Cable Lateral Raise')).toMatchObject({ to: 'Lateral Raise', since: DATE, bridge_until: null });
    expect(screen.getByText('Switched to Lateral Raise')).toBeTruthy();
  });
});

describe('settings that could not be read', () => {
  // The stored settings fail to load, so settings writes are refused: the cards must say so, not look saved.
  const broken = (d: Db) => {
    const get = d.getFirstAsync.bind(d);
    d.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('user_settings')) throw new Error('unreadable');
      return get(sql, ...p);
    }) as Db['getFirstAsync'];
  };
  it('Try it again does not mark the rule done and says it did not save', async () => {
    const db = await openSession(async (d) => {
      await saveExclusion(d, ended());
      seed(d, 'Pec Deck Fly', lift());
      broken(d);
    });
    await press('Try it again, Pec Deck Fly');
    expect(await screen.findByText(/Couldn’t read your saved settings, so changes are not saved/)).toBeTruthy();
    expect(stored<ExclusionRecord>(db, 'exclusions:r1').done).toBe(false);
    expect(screen.getByText('Ready to try Pec Deck Fly again?')).toBeTruthy();
  });

  it('Switch to 6–8 says it did not save, and the card stays', async () => {
    const db = await started((d) => {
      seed(d, 'Pec Deck Fly', lift({ sets: [set(10)], hist: [50, 60, 59, 59.5, 60].map((e, i) => ({ date: `2026-09-${10 + i}`, e })) }));
      broken(d);
    });
    await press('Switch to 6–8, Pec Deck Fly');
    expect(await screen.findByText(/Couldn’t read your saved settings, so changes are not saved/)).toBeTruthy();
    expect(db.rows.get('user_settings:me')).toBeUndefined();
    expect(screen.getByText('No progress in 3 sessions')).toBeTruthy();
  });
});

describe('stall card on a non-gym day', () => {
  it('offers only a similar exercise the day’s equipment allows', async () => {
    const stalled = lift({ sets: [set(10)], hist: [50, 60, 59, 59.5, 60].map((e, i) => ({ date: `2026-09-${10 + i}`, e })) });
    // Gym: Cable Lateral Raise has Lateral Raise as its sideways exercise.
    await started((d) => seed(d, 'Cable Lateral Raise', stalled));
    expect(screen.getByLabelText('Or switch to Lateral Raise, Cable Lateral Raise')).toBeTruthy();
  });
  it('with dumbbells only, the cable exercise is not offered', async () => {
    const stalled = lift({ sets: [set(10)], hist: [50, 60, 59, 59.5, 60].map((e, i) => ({ date: `2026-09-${10 + i}`, e })) });
    const db = memoryDb();
    await saveProfile(db, { ...profile(), where: 'dumbbells' });
    seed(db, 'Lateral Raise', stalled);
    await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('No progress in 3 sessions');
    expect(screen.queryByLabelText(/^Or switch to /)).toBeNull();
  });
});

describe('the day’s where, not the profile’s', () => {
  it('a gym profile with a dumbbells day offers no cable swap', async () => {
    const db = memoryDb();
    await saveProfile(db, profile()); // gym
    const w: Workout = { id: null, version: 0, updated_at: 'x', deleted_at: null, date: DATE, template: 'Push B', base: 'Push B', where: 'dumbbells', cardio_min: null, mods: {}, exercises: [{ name: 'Lateral Raise', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }], ci_choice: null };
    await saveWorkout(db, w);
    const ex = { name: 'Lateral Raise', part: 1 as const, bridge: false, form: null, found: null, skipRamp: false, sets: [blankRow()], ramp: [] };
    await saveSet(db, DATE, setRecord(ex, 'work', 0, THURSDAY()));
    seed(db, 'Lateral Raise', lift({ sets: [set(10)], hist: [50, 60, 59, 59.5, 60].map((e, i) => ({ date: `2026-09-${10 + i}`, e })) }));
    await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
    await screen.findByText('No progress in 3 sessions');
    // On the profile's gym, Cable Lateral Raise would be offered.
    expect(screen.queryByLabelText(/^Or switch to /)).toBeNull();
  });
});

describe('Targets: avoided and swapped exercises', () => {
  it('lists them, and Remove and Undo write tombstones', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveExclusion(db, ended({ until: null, reason: 'pain' }));
    await saveSwap(db, { id: '', version: 0, updated_at: 'x', deleted_at: null, from: 'Machine Shoulder Press', to: 'Seated Dumbbell Press', since: '2026-10-05', bridge_until: '2026-10-18' });
    await render(withProfile(db, <TargetsScreen db={db} now={THURSDAY} />));
    expect(await screen.findByText('Pec Deck Fly (pain), permanent')).toBeTruthy();
    expect(screen.getByText('Machine Shoulder Press → Seated Dumbbell Press, bridge until 18 Oct')).toBeTruthy();
    await press('Remove Pec Deck Fly (pain), permanent');
    await press('Undo swap of Machine Shoulder Press');
    await waitFor(() => expect(screen.queryByText('Pec Deck Fly (pain), permanent')).toBeNull());
    expect(stored<ExclusionRecord>(db, 'exclusions:r1').deleted_at).toMatch(/^2026-|^20\d\d-/);
    expect(stored<{ deleted_at: string }>(db, 'swaps:Machine Shoulder Press').deleted_at).toBeTruthy();
    // The section stays (it holds "Add an exercise to avoid", as in the prototype), but the removed rules and swaps are gone.
    expect(screen.queryByText('Avoiding')).toBeNull();
    expect(screen.queryByText('Swapped')).toBeNull();
    expect(screen.getByLabelText('Add an exercise to avoid')).toBeTruthy();
  });
});
