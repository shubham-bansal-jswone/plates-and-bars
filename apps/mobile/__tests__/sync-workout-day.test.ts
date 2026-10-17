/** @jest-environment node */
import { createClient } from '@plate-and-bar/api';
import { syncOnce } from '../src/sync/engine';
import { saveSet, saveWorkout, loadSets, loadWorkout } from '../src/db/workouts';
import { setKv, KEY_USER } from '../src/sync/store';
import { quarantineKey } from '../src/sync/quarantine';
import { naturalId } from '../src/sync/ids';
import { exercisesFrom } from '../src/workout/model';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { openDb, fakeServer, memoryTokens, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: jest.fn(() => Promise.resolve()) }));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DATE = '2026-10-08';

/** Two devices of one account (their own stores) and one server that settles conflicts by `updated_at`. */
async function devices() {
  const server = fakeServer(USER);
  server.byUpdatedAt = true;
  server.relay = true;
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  const make = async () => {
    const db = await openDb();
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
    return { db, sync: () => syncOnce(deps) };
  };
  return { server, a: await make(), b: await make() };
}

const cardioDay = (min: number, at: string): Workout => ({ id: null, version: 0, updated_at: at, deleted_at: null, date: DATE, template: null, base: null, where: null, cardio_min: min, mods: {}, exercises: [], ci_choice: null });
const sessionDay = (at: string): Workout => ({ ...cardioDay(0, at), cardio_min: null, template: 'Upper A', base: 'Upper A', where: 'gym', mods: { deload: false, light: false, reentry: 0, short: false, where: 'gym' }, exercises: [{ name: 'Bench', part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false }] });
const benchSet = (at: string): WorkoutSet => ({ id: '11111111-1111-4111-8111-111111111111', version: 0, updated_at: at, deleted_at: null, workout_id: null, exercise: 'Bench', kind: 'work', set_index: 0, weight_kg: 60, reps: 8, done: true, rate: null, t: null });

async function shows(db: Awaited<ReturnType<typeof openDb>>) {
  const w = (await loadWorkout(db, DATE)) as Workout;
  return { cardio: w.cardio_min, template: w.template, shown: exercisesFrom(w, await loadSets(db, DATE)).map((e) => [e.name, e.sets.length]) };
}
const BOTH = { cardio: 30, template: 'Upper A', shown: [['Bench', 1]] };

describe('two devices edit the same workout day (#647)', () => {
  it('cardio minutes logged first, then a session started offline on the other device: both survive on both devices', async () => {
    const { a, b } = await devices();
    await saveWorkout(a.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await saveWorkout(b.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await saveSet(b.db, DATE, benchSet('2026-10-08T11:00:00.000Z'));
    await a.sync();
    await b.sync();
    await a.sync();
    await b.sync();
    expect(await shows(b.db)).toEqual(BOTH);
    expect(await shows(a.db)).toEqual(BOTH);
  });

  it('the cardio edit is the later one: the session is still there', async () => {
    const { a, b } = await devices();
    await saveWorkout(b.db, sessionDay('2026-10-08T10:00:00.000Z'));
    await saveSet(b.db, DATE, benchSet('2026-10-08T10:00:00.000Z'));
    await saveWorkout(a.db, cardioDay(30, '2026-10-08T11:00:00.000Z'));
    await b.sync();
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await shows(a.db)).toEqual(BOTH);
    expect(await shows(b.db)).toEqual(BOTH);
  });

  it('the other device stored the day after this one last pulled: the push conflict is merged and sent again', async () => {
    const { server, a, b } = await devices();
    await a.sync(); // both are up to date and online
    await b.sync();
    const id = await naturalId(USER, 'workouts', DATE);
    // Another device's cardio-only day sits on the server; this one never pulled it (it does not come back as a change).
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T12:00:00Z'), id, version: 1 });
    await saveWorkout(b.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await saveSet(b.db, DATE, benchSet('2026-10-08T11:00:00.000Z'));
    await b.sync();
    expect(await shows(b.db)).toEqual(BOTH);
    await b.sync(); // the merged day goes out with the next sync
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 30, template: 'Upper A' });
  });

  /** Both devices hold the day at v1 (a session and 30 min of cardio); A then has a queued edit and B stores a later one first. */
  async function seen() {
    const d = await devices();
    await saveWorkout(d.a.db, { ...sessionDay('2026-10-08T09:00:00.000Z'), cardio_min: 30 });
    await saveSet(d.a.db, DATE, benchSet('2026-10-08T09:00:00.000Z'));
    await d.a.sync();
    await d.b.sync();
    const edit = async (db: typeof d.a.db, change: Partial<Workout>) => saveWorkout(db, { ...((await loadWorkout(db, DATE)) as Workout), ...change });
    return { ...d, edit, id: await naturalId(USER, 'workouts', DATE) };
  }

  it('a session removed on the other device stays removed (both had seen the day)', async () => {
    const { server, a, b, edit, id } = await seen();
    await edit(a.db, { cardio_min: 40, updated_at: '2026-10-08T11:00:00.000Z' });
    await edit(b.db, { template: null, base: null, exercises: [], updated_at: '2026-10-08T12:00:00.000Z' });
    await b.sync();
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ template: null, exercises: [] });
    expect(((await loadWorkout(a.db, DATE)) as Workout).exercises).toEqual([]);
  });

  it('cardio minutes cleared on the other device stay cleared (both had seen the day)', async () => {
    const { server, a, b, edit, id } = await seen();
    await edit(a.db, { ci_choice: 'light', updated_at: '2026-10-08T11:00:00.000Z' });
    await edit(b.db, { cardio_min: null, updated_at: '2026-10-08T12:00:00.000Z' });
    await b.sync();
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: null });
    expect(((await loadWorkout(a.db, DATE)) as Workout).cardio_min).toBeNull();
  });

  it('a queued live day against a day deleted on the other device is not merged', async () => {
    const { server, a, b } = await devices();
    const id = await naturalId(USER, 'workouts', DATE);
    await saveWorkout(b.db, { ...cardioDay(0, '2026-10-08T10:00:00.000Z'), deleted_at: '2026-10-08T10:00:00.000Z' });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await b.sync();
    await a.sync(); // later edit: it stands as it is, nothing is mixed in from the tombstone
    expect(server.get('workouts', id)).toMatchObject({ deleted_at: null, template: 'Upper A' });
  });

  it('a queued deleted day against a live day from the other device is not merged', async () => {
    const { server, a, b } = await devices();
    const id = await naturalId(USER, 'workouts', DATE);
    await saveWorkout(b.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await saveWorkout(a.db, { ...sessionDay('2026-10-08T11:00:00.000Z'), deleted_at: '2026-10-08T11:00:00.000Z' });
    await b.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ deleted_at: '2026-10-08T11:00:00.000Z', cardio_min: null });
  });

  it('a set-aside day is not merged or sent again without an edit', async () => {
    const { server, a, b } = await devices();
    await saveWorkout(b.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await b.sync();
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    const e = await a.db.getFirstAsync<{ seq: number; tbl: 'workouts'; key: string }>("SELECT seq, tbl, key FROM sync_outbox WHERE tbl = 'workouts'");
    await a.db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', quarantineKey(e as never), 'x');
    const before = server.pushed().length;
    await a.sync();
    expect(server.pushed().length).toBe(before);
    expect(((await loadWorkout(a.db, DATE)) as Workout).cardio_min).toBeNull();
    expect(await a.db.getFirstAsync("SELECT 1 FROM sync_outbox WHERE tbl = 'workouts' AND seq = ?", (e as { seq: number }).seq)).not.toBeNull();
  });

  it('a server that always says has_more does not keep the run going', async () => {
    const { server, a } = await devices();
    server.alwaysMore = true;
    await saveWorkout(a.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await a.sync();
    expect(server.calls.filter((c) => c.path === '/sync').length).toBeLessThanOrEqual(41);
  });

  it('a day whose first push was stored but its answer lost is not merged (it saw a server copy)', async () => {
    const { server, a, b } = await devices();
    const id = await naturalId(USER, 'workouts', DATE);
    await saveWorkout(a.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    server.losePushResponses = 1;
    await a.sync(); // the server stored it as v1; A still holds it at v0
    await b.sync();
    await saveWorkout(b.db, { ...((await loadWorkout(b.db, DATE)) as Workout), cardio_min: null, updated_at: '2026-10-08T12:00:00.000Z' });
    await b.sync(); // v2: the minutes are cleared
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: null });
    expect(((await loadWorkout(a.db, DATE)) as Workout).cardio_min).toBeNull();
  });
});
