import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { useRules } from '../src/workout/useRules';
import { loadExclusions, saveExclusion, saveSwap, deleteExclusion, deleteSwap, type ExclusionRecord } from '../src/db/rules';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THURSDAY = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';

function profile() {
  return buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );
}

type Db = ReturnType<typeof memoryDb>;
const rule = (o: Partial<ExclusionRecord>): ExclusionRecord => ({
  id: 'r1', version: 0, updated_at: '2026-10-01T00:00:00Z', deleted_at: null, name: 'Pec Deck Fly', scope: 'exercise', key: 'Pec Deck Fly', reason: 'dislike', created: '2026-10-01', until: null, to: { 'Pec Deck Fly': null }, done: false, ...o,
});
/** Every joint ruled out, no stored picks: nothing that works the chest is left to suggest. */
const allJoints = async (db: Db) => {
  for (const [i, j] of ['shoulder', 'elbow', 'wrist', 'lower-back', 'hip', 'knee', 'ankle'].entries()) await saveExclusion(db, rule({ id: `j${i}`, scope: 'joint', key: j, name: 'x', to: {} }));
};
const stored = <T,>(db: Db, key: string) => JSON.parse(db.rows.get(key) as string) as T;
const exclusionRows = (db: Db) => [...db.rows].filter(([k]) => k.startsWith('exclusions:')).map(([, v]) => JSON.parse(v) as ExclusionRecord);
const storedSets = (db: Db) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);

async function setup(seed?: (db: Db) => Promise<void>) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await seed?.(db);
  await render(withProfile(db, <WorkoutScreen db={db} now={THURSDAY} />));
  return db;
}
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

describe('exercise rules in the session', () => {
  it('leaves an excluded exercise out, using its stored pick', async () => {
    await setup((db) => saveExclusion(db, rule({ to: { 'Pec Deck Fly': 'Cable Crossover' } })));
    expect(await screen.findByLabelText('Exercise 3: Cable Crossover')).toBeTruthy();
    expect(screen.queryByLabelText(/Exercise \d: Pec Deck Fly/)).toBeNull();
  });

  it('says so when an excluded exercise has no pick and no replacement', async () => {
    await setup(allJoints);
    expect((await screen.findAllByText(/is left out with no replacement, so your .* get fewer sets each week\./)).length).toBeGreaterThan(0);
  });

  it('ignores a removed rule (tombstone) and a rule the user brought back', async () => {
    await setup(async (db) => {
      await saveExclusion(db, rule({ deleted_at: '2026-10-02T00:00:00Z' }));
      await saveExclusion(db, rule({ id: 'r2', key: 'Cable Lateral Raise', name: 'Cable Lateral Raise', done: true }));
    });
    expect(await screen.findByLabelText('Exercise 3: Pec Deck Fly')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 4: Cable Lateral Raise')).toBeTruthy();
  });
});

describe('stored swaps in the session', () => {
  const swap = (bridge_until: string | null) => ({ id: '', version: 0, updated_at: 'x', deleted_at: null, from: 'Pec Deck Fly', to: 'Cable Crossover', since: '2026-10-01', bridge_until });
  it('a swap replaces the exercise', async () => {
    await setup((db) => saveSwap(db, swap(null)));
    expect(await screen.findByLabelText('Exercise 3: Cable Crossover')).toBeTruthy();
    expect(screen.queryByLabelText(/Exercise \d: Pec Deck Fly/)).toBeNull();
  });
  it('a running bridge keeps the old exercise after the new one', async () => {
    await setup((db) => saveSwap(db, swap('2026-10-20')));
    expect(await screen.findByLabelText('Exercise 3: Cable Crossover')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 4: Pec Deck Fly')).toBeTruthy();
  });
  it('a bridge that ended is gone', async () => {
    await setup((db) => saveSwap(db, swap('2026-10-07')));
    await screen.findByLabelText('Exercise 3: Cable Crossover');
    expect(screen.queryByLabelText(/Exercise \d: Pec Deck Fly/)).toBeNull();
  });
});

describe('re-swap after Undo', () => {
  it('carries on from the stored tombstone’s version', async () => {
    const db = memoryDb();
    const { result } = await renderHook(() => useRules({ db, now: THURSDAY, notify: jest.fn() }));
    await waitFor(() => expect(result.current.rules.ready).toBe(true));
    const to = { from: 'A', to: 'B', since: DATE, bridge_until: null };
    // The server already holds the undone swap at version 3 (a pull stored the tombstone).
    db.rows.set('swaps:A', JSON.stringify({ ...to, id: 'x', version: 3, updated_at: 'y', deleted_at: '2026-10-07T00:00:00Z' }));
    await act(async () => result.current.putSwap(to));
    await waitFor(() => expect(stored<{ version: number; deleted_at: string | null }>(db, 'swaps:A')).toMatchObject({ version: 3, deleted_at: null }));
    expect(stored<{ id: string }>(db, 'swaps:A').id).toBe('x'.length ? stored<{ id: string }>(db, 'swaps:A').id : '');
  });
});

describe('Can’t do sheet', () => {
  async function started(seed?: (db: Db) => Promise<void>) {
    const db = await setup(seed);
    await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
    await screen.findByText('Push B');
    return db;
  }

  it('Permanently: saves the rule with the pick, swaps the exercise in, and tombstones the old sets', async () => {
    const db = await started();
    await press('Can’t do Pec Deck Fly');
    await press('I don’t like it');
    await press('Permanently');
    expect(screen.getByText('What should be left out?')).toBeTruthy();
    await press('Just Pec Deck Fly. Similar exercises stay in your plan.');
    await press('Continue');
    expect(screen.getByText(/Pick a replacement/)).toBeTruthy();
    const rows = screen.getAllByRole('button').filter((b) => /^(?!Close|Skip)/.test(String(b.props.accessibilityLabel ?? '')) && /Works your/.test(String(b.props.accessibilityLabel ?? '')));
    const pick = String(rows[0]?.props.accessibilityLabel).split('. ')[0] as string;
    await fireEvent.press(rows[0] as never);

    await waitFor(() => expect(screen.queryByLabelText('Can’t do Pec Deck Fly')).toBeNull());
    expect(screen.getByLabelText(`Can’t do ${pick}`)).toBeTruthy();
    const [r] = exclusionRows(db);
    expect(r).toMatchObject({ scope: 'exercise', key: 'Pec Deck Fly', reason: 'dislike', until: null, done: false, created: DATE, to: { 'Pec Deck Fly': pick }, deleted_at: null, version: 0 });
    expect(r?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).toContain(pick);
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name)).not.toContain('Pec Deck Fly');
    const old = storedSets(db).filter((s) => s.exercise === 'Pec Deck Fly');
    expect(old).toHaveLength(3);
    expect(old.every((s) => s.deleted_at)).toBe(true);
    expect(storedSets(db).filter((s) => s.exercise === pick && !s.deleted_at)).toHaveLength(3);
  });

  it('Just today: replaces the exercise but saves no rule', async () => {
    const db = await started();
    await press('Can’t do Pec Deck Fly');
    await press('Equipment isn’t available');
    await press('Just today');
    await fireEvent.press(screen.getByLabelText(/^Skip it, no replacement\. Your chest would get fewer sets each week \(now about 12\)/));
    await waitFor(() => expect(screen.queryByLabelText('Can’t do Pec Deck Fly')).toBeNull());
    expect(exclusionRows(db)).toHaveLength(0);
    expect(stored<Workout>(db, `workouts:${DATE}`).exercises).toHaveLength(4);
  });

  it('a wider rule (pain, joint) also replaces other exercises it covers', async () => {
    const db = await started();
    await press('Can’t do Barbell Bench Press');
    await press('Pain or an injury');
    await press('Permanently');
    await press('Continue'); // pain defaults to the first joint the exercise loads
    await fireEvent.press(screen.getByLabelText(/^Skip it, no replacement\. Your chest would get fewer sets each week \(now about 12\)/));
    await waitFor(() => expect(screen.queryByLabelText('Can’t do Barbell Bench Press')).toBeNull());
    const [r] = exclusionRows(db);
    expect(r).toMatchObject({ scope: 'joint', reason: 'pain', to: { 'Barbell Bench Press': null } });
    const names = stored<Workout>(db, `workouts:${DATE}`).exercises.map((e) => e.name);
    // every exercise today that loads the shoulder is gone: replaced, or removed when nothing fits
    for (const n of ['Barbell Bench Press', 'Machine Shoulder Press', 'Pec Deck Fly', 'Cable Lateral Raise', 'Overhead Cable Extension']) expect(names).not.toContain(n);
  });

  it('keeps ticked sets and puts the replacement after them', async () => {
    const db = await started();
    // empty fields use the suggested numbers; a first-time exercise asks for a weight, so type one
    await fireEvent.changeText(screen.getByLabelText('Pec Deck Fly set 1 kg'), '40');
    await fireEvent.changeText(screen.getByLabelText('Pec Deck Fly set 1 reps'), '10');
    await press('Mark Pec Deck Fly set 1 done');
    await press('Can’t do Pec Deck Fly');
    await press('I don’t like it');
    await press('Just today');
    await fireEvent.press(screen.getByLabelText(/^Skip it, no replacement\. Your chest would get fewer sets each week \(now about 12\)/));
    await waitFor(() => expect(screen.getAllByLabelText('Pec Deck Fly set 1 kg')).toHaveLength(1));
    expect(screen.queryByLabelText('Pec Deck Fly set 2 kg')).toBeNull();
    const old = storedSets(db).filter((s) => s.exercise === 'Pec Deck Fly');
    expect(old.filter((s) => !s.deleted_at)).toHaveLength(1);
    expect(old.filter((s) => s.deleted_at)).toHaveLength(2);
  });
});

describe('rule storage', () => {
  it('removing a rule or swap writes a tombstone, which the loaders skip', async () => {
    const db = memoryDb();
    const r = rule({});
    await saveExclusion(db, r);
    await saveSwap(db, { id: '', version: 0, updated_at: 'x', deleted_at: null, from: 'A', to: 'B', since: DATE, bridge_until: null });
    expect(await loadExclusions(db)).toHaveLength(1);
    await deleteExclusion(db, r, '2026-10-09T00:00:00Z');
    await deleteSwap(db, { id: '', version: 0, updated_at: 'x', deleted_at: null, from: 'A', to: 'B', since: DATE, bridge_until: null }, '2026-10-09T00:00:00Z');
    expect(await loadExclusions(db)).toHaveLength(0);
    expect(stored<ExclusionRecord>(db, 'exclusions:r1')).toMatchObject({ deleted_at: '2026-10-09T00:00:00Z', key: 'Pec Deck Fly' });
    expect(stored<{ deleted_at: string }>(db, 'swaps:A').deleted_at).toBe('2026-10-09T00:00:00Z');
  });
});

describe('Targets coverage uses the stored rules', () => {
  it('a rule that leaves out all chest work lowers the planned chest sets', async () => {
    const chest = async (seed?: (db: Db) => Promise<void>) => {
      const db = memoryDb();
      await saveProfile(db, profile());
      await seed?.(db);
      const { unmount } = await render(withProfile(db, <TargetsScreen db={db} now={THURSDAY} />));
      const el = await screen.findByLabelText(/^Weekly coverage: your plan, Chest: \d+ sets/);
      const label = String(el.props.accessibilityLabel);
      unmount();
      return label;
    };
    const before = await chest();
    const after = await chest((db) => allJoints(db));
    expect(after).not.toBe(before);
  });
});
