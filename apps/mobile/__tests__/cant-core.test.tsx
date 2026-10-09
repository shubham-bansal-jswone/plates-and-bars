import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { catalog } from '../src/workout/catalog';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
type Db = ReturnType<typeof memoryDb>;
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const workout = (db: Db) => JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout;
const sets = (db: Db) => [...db.sets.values()].map((s) => JSON.parse(s.data) as WorkoutSet);
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

/** Builds today's Push B on the Workout tab, then leaves it. */
async function built() {
  const db = memoryDb();
  await saveProfile(db, profile());
  await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
  await press((await screen.findByLabelText('Start Push B')).props.accessibilityLabel);
  await screen.findByText('Push B');
  await waitFor(() => expect(sets(db).length).toBeGreaterThan(0));
  await cleanup();
  return db;
}

async function avoidOnTargets(db: Db, name: string, reason: string, scopeLabel: RegExp) {
  await render(withProfile(db, <TargetsScreen db={db} now={NOW} />));
  await fireEvent.press(await screen.findByLabelText('Add an exercise to avoid'));
  await fireEvent.press(screen.getByLabelText(name));
  await fireEvent.press(screen.getByLabelText(reason));
  await fireEvent.press(screen.getByLabelText('Permanently'));
  await fireEvent.press(screen.getAllByLabelText(scopeLabel)[0] as never);
  await fireEvent.press(screen.getByLabelText('Continue'));
  await fireEvent.press(await screen.findByLabelText(/^Skip it, no replacement/));
}

describe('Targets avoid picker applies a wider rule to today’s built session', () => {
  it('a pattern rule replaces every exercise of that pattern, tombstones their sets and adds sets with ids', async () => {
    const db = await built();
    const before = workout(db).exercises.map((e) => e.name);
    const target = before[0] as string;
    const pattern = (catalog.tags[target] as { pattern: string }).pattern;
    const inPattern = before.filter((n) => catalog.tags[n]?.pattern === pattern);
    // Stored sets carry a newer server version: the tombstones keep it (merge inside the queue).
    for (const [k, v] of db.sets) db.sets.set(k, { ...v, data: JSON.stringify({ ...JSON.parse(v.data), version: 4 }) });
    await avoidOnTargets(db, target, 'I don’t like it', /^All /);
    await waitFor(() => expect(workout(db).exercises.map((e) => e.name)).not.toContain(target));
    const after = workout(db).exercises.map((e) => e.name);
    expect(after.some((n) => inPattern.includes(n))).toBe(false);
    const old = sets(db).filter((s) => inPattern.includes(s.exercise));
    expect(old.length).toBeGreaterThan(0);
    expect(old.every((s) => s.deleted_at && s.version === 4)).toBe(true);
    const live = sets(db).filter((s) => !s.deleted_at);
    expect(live.every((s) => /^[0-9a-f-]{36}$/.test(s.id))).toBe(true);
    for (const n of after) expect(live.some((s) => s.exercise === n && s.kind === 'work')).toBe(true);
  });

  it('an exercise-only rule leaves today’s session as it is', async () => {
    const db = await built();
    const snapshot = JSON.stringify([workout(db), sets(db)]);
    await avoidOnTargets(db, 'Barbell Bench Press', 'I don’t like it', /^Just Barbell Bench Press/);
    await waitFor(() => expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(true));
    expect(JSON.stringify([workout(db), sets(db)])).toBe(snapshot);
  });

  it('with no session built, only the rule is stored', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await avoidOnTargets(db, 'Barbell Bench Press', 'Pain or an injury', /^Anything that loads/);
    await waitFor(() => expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(true));
    expect(db.rows.has(`workouts:${DATE}`)).toBe(false);
    expect(db.sets.size).toBe(0);
  });

  it('the Workout tab shows the changed session when it is shown again', async () => {
    const db = await built();
    const target = workout(db).exercises[0]!.name;
    await avoidOnTargets(db, target, 'I don’t like it', /^All /);
    await waitFor(() => expect(workout(db).exercises.map((e) => e.name)).not.toContain(target));
    await cleanup();
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await screen.findByText('Push B');
    expect(screen.queryByLabelText(`Can’t do ${target}`)).toBeNull();
  });
});

describe('Can’t-do sheet options come from core', () => {
  it('lists the family with its count and preselects the family for form worries', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await render(withProfile(db, <TargetsScreen db={db} now={NOW} />));
    await fireEvent.press(await screen.findByLabelText('Add an exercise to avoid'));
    await fireEvent.press(screen.getByLabelText('Barbell Bench Press'));
    await fireEvent.press(screen.getByLabelText('Not confident with the form'));
    await fireEvent.press(screen.getByLabelText('Permanently'));
    const fam = (catalog.tags['Barbell Bench Press'] as { family: string }).family;
    const n = Object.values(catalog.tags).filter((x) => x.family === fam).length;
    expect(screen.getByLabelText(new RegExp(`${n} exercises`))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Continue'));
    await fireEvent.press(await screen.findByLabelText(/^Skip it, no replacement/));
    await waitFor(() => expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(true));
    const r = JSON.parse([...db.rows].find(([k]) => k.startsWith('exclusions:'))![1]);
    expect(r).toMatchObject({ scope: 'family', key: fam });
  });
});

describe('Workout tab can’t-do uses core and merges inside the queue', () => {
  it('tombstones the old sets at the stored version and stores new blank sets with ids', async () => {
    const db = await built();
    const target = workout(db).exercises[0]!.name;
    await render(withProfile(db, <WorkoutScreen db={db} now={NOW} />));
    await screen.findByLabelText(`Can’t do ${target}`);
    // A pull stored newer versions after the tab loaded: the screen's copy is stale, the queued write must merge.
    for (const [k, v] of db.sets) db.sets.set(k, { ...v, data: JSON.stringify({ ...JSON.parse(v.data), version: 6 }) });
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...workout(db), version: 9 }));
    await press(`Can’t do ${target}`);
    await press('I don’t like it');
    await press('Just today');
    await fireEvent.press(await screen.findByLabelText(/^Skip it, no replacement/));
    await waitFor(() => expect(workout(db).exercises.map((e) => e.name)).not.toContain(target));
    const old = sets(db).filter((s) => s.exercise === target);
    expect(old.length).toBeGreaterThan(0);
    expect(old.every((s) => s.deleted_at && s.version === 6)).toBe(true);
    expect(workout(db).version).toBe(9);
    expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(false);
  });
});

describe('Targets path edge cases', () => {
  it('keeps ticked sets: an exercise with a ticked set is not replaced by a wider rule', async () => {
    const db = await built();
    const target = workout(db).exercises[0]!.name;
    for (const [k, v] of db.sets) {
      const rec = JSON.parse(v.data) as WorkoutSet;
      if (rec.exercise === target && rec.kind === 'work' && rec.set_index === 0) db.sets.set(k, { ...v, done: 1, data: JSON.stringify({ ...rec, done: true, weight_kg: 20, reps: 8 }) });
    }
    const before = sets(db).filter((s) => s.exercise === target);
    await avoidOnTargets(db, target, 'I don’t like it', /^All /);
    await waitFor(() => expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(true));
    await waitFor(() => expect(workout(db).exercises.length).toBeGreaterThan(0));
    expect(workout(db).exercises.map((e) => e.name)).toContain(target);
    expect(sets(db).filter((s) => s.exercise === target)).toEqual(before);
  });

  it('a failed write to today’s workout shows a message and the rule is still stored', async () => {
    const db = await built();
    const target = workout(db).exercises[0]!.name;
    const run = db.runAsync.bind(db);
    db.runAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('INTO workouts') || sql.includes('INTO workout_sets')) throw new Error('disk');
      return run(sql, ...p);
    }) as typeof db.runAsync;
    await avoidOnTargets(db, target, 'I don’t like it', /^All /);
    expect(await screen.findByText('Couldn’t update today’s workout. Try again.')).toBeTruthy();
    expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(true);
  });

  it('when the rules become unreadable while the sheet is open, nothing is saved and today stays as it was', async () => {
    const db = await built();
    const target = workout(db).exercises[0]!.name;
    const snapshot = JSON.stringify([workout(db), sets(db)]);
    const ui = (v: number) => withProfile(db, <SyncContext.Provider value={{ dataVersion: v } as SyncState}><TargetsScreen db={db} now={NOW} /></SyncContext.Provider>);
    const view = await render(ui(0));
    await fireEvent.press(await screen.findByLabelText('Add an exercise to avoid'));
    await fireEvent.press(screen.getByLabelText(target));
    await fireEvent.press(screen.getByLabelText('I don’t like it'));
    await fireEvent.press(screen.getByLabelText('Permanently'));
    await fireEvent.press(screen.getAllByLabelText(/^All /)[0] as never);
    await fireEvent.press(screen.getByLabelText('Continue'));
    const real = db.getAllAsync.bind(db);
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM exclusions')) throw new Error('disk');
      return real(sql, ...p);
    }) as typeof db.getAllAsync;
    await view.rerender(ui(1)); // a sync pull makes the rules read again, and the read fails
    await waitFor(() => expect(screen.queryByText(/Couldn’t read your saved exercise rules/)).toBeTruthy());
    await fireEvent.press(await screen.findByLabelText(/^Skip it, no replacement/));
    await new Promise((r) => setTimeout(r, 50));
    expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(false);
    expect(JSON.stringify([workout(db), sets(db)])).toBe(snapshot);
  });
});
