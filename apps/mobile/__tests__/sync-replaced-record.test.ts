/** @jest-environment node */
import { createClient } from '@plate-and-bar/api';
import { syncOnce } from '../src/sync/engine';
import { saveSet, saveWorkout, loadWorkout, loadSets } from '../src/db/workouts';
import { getKv, setKv, KEY_USER } from '../src/sync/store';
import { naturalId } from '../src/sync/ids';
import { exercisesFrom } from '../src/workout/model';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { setBase } from '../src/sync/base';
import { saveWeightDoc } from './sync-fixtures';
import { openDb, fakeServer, memoryTokens, seedConsent } from './sync-helpers';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-crypto', () => require('./sync-crypto-mock'));
jest.mock('../src/photos/vault', () => ({ deleteKitchenPhoto: jest.fn(() => Promise.resolve()) }));

const USER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const DATE = '2026-10-08';

type Db = Awaited<ReturnType<typeof openDb>>;

/** Two devices of one account and one server that settles conflicts by `updated_at` and returns `replaced_record` on `client_won` (contract 0.1.20). */
async function devices() {
  const server = fakeServer(USER);
  server.byUpdatedAt = true;
  server.relay = true;
  const fetchOf = { current: server.fetch as (i: Request | string | URL) => Promise<Response> };
  (globalThis as { fetch: unknown }).fetch = (i: Request | string | URL) => fetchOf.current(i);
  const make = async () => {
    const db = await openDb();
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    await setKv(db, KEY_USER, USER);
    await seedConsent(db);
    const deps = { db, api: createClient('http://fake/api/v1', async () => (await tokens.load())?.access ?? null), tokens };
    return { db, sync: () => syncOnce(deps) };
  };
  /** Runs `fn` once, just before the next request that carries changes goes out (the pre-pull request carries none). */
  const beforePush = (fn: () => Promise<void> | void) => {
    fetchOf.current = async (input) => {
      const req = input as Request;
      const body = JSON.parse(await req.clone().text()) as { changes?: object };
      if (new URL(req.url).pathname.endsWith('/sync') && Object.keys(body.changes ?? {}).length > 0) {
        fetchOf.current = server.fetch;
        await fn();
      }
      return server.fetch(input);
    };
  };
  return { server, a: await make(), b: await make(), beforePush, id: await naturalId(USER, 'workouts', DATE) };
}

const MODS = { deload: false, light: false, reentry: 0, short: false, where: 'gym' as const };
const bench = { name: 'Bench', part: 1 as const, bridge: false, form: null, found_kg: null, skip_ramp: false };
const row = { name: 'Row', part: 1 as const, bridge: false, form: null, found_kg: null, skip_ramp: false };
const cardioDay = (min: number | null, at: string): Workout => ({ id: null, version: 0, updated_at: at, deleted_at: null, date: DATE, template: null, base: null, where: null, cardio_min: min, mods: {}, exercises: [], ci_choice: null });
const sessionDay = (at: string, min: number | null = null): Workout => ({ ...cardioDay(min, at), template: 'Upper A', base: 'Upper A', where: 'gym', mods: MODS, exercises: [bench] });
const benchSet = (at: string): WorkoutSet => ({ id: '11111111-1111-4111-8111-111111111111', version: 0, updated_at: at, deleted_at: null, workout_id: null, exercise: 'Bench', kind: 'work', set_index: 0, weight_kg: 60, reps: 8, done: true, rate: null, t: null });
const load = async (db: Db) => (await loadWorkout(db, DATE)) as Workout;
const shows = async (db: Db) => {
  const w = await load(db);
  return { cardio: w.cardio_min, template: w.template, shown: exercisesFrom(w, await loadSets(db, DATE)).map((e) => [e.name, e.sets.length]) };
};
const BOTH = { cardio: 30, template: 'Upper A', shown: [['Bench', 1]] };
const workoutPushes = (server: ReturnType<typeof fakeServer>) => server.pushed().filter((r) => r.table === 'workouts');

describe('client_won returns the replaced record (#818)', () => {
  it('a day stored by another device between this one\'s pull and push is merged and sent as an ordinary edit', async () => {
    const { server, a, id } = await devices();
    await a.sync();
    // Another device stored its cardio-only day (earlier than this edit); this one never pulled it.
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1 });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await saveSet(a.db, DATE, benchSet('2026-10-08T11:00:00.000Z'));
    await a.sync(); // client_won with replaced_record
    expect(await shows(a.db)).toEqual(BOTH);
    const queued = await a.db.getFirstAsync("SELECT 1 FROM sync_outbox WHERE tbl = 'workouts'");
    expect(queued).not.toBeNull();
    expect(((await load(a.db)).version)).toBe(2); // at server_version: an ordinary edit
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 30, template: 'Upper A', version: 3 });
    expect(await a.db.getFirstAsync("SELECT 1 FROM sync_outbox WHERE tbl = 'workouts'")).toBeNull();
  });

  it('the other device then pulls the merged day', async () => {
    const { server, a, b, id } = await devices();
    await a.sync();
    await b.sync();
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1 });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await saveSet(a.db, DATE, benchSet('2026-10-08T11:00:00.000Z'));
    await a.sync();
    await a.sync();
    await b.sync();
    expect((await load(b.db)).cardio_min).toBe(30);
    expect((await load(b.db)).template).toBe('Upper A');
  });

  it('a session removed here stays removed: a day this device had seen is not merged', async () => {
    const { server, a, b, id } = await devices();
    await saveWorkout(a.db, sessionDay('2026-10-08T09:00:00.000Z', 30));
    await a.sync();
    await b.sync(); // both hold v1
    // B edits the cardio minutes and stores first; A then removes the session, later, and pushes at v1: client_won.
    await saveWorkout(b.db, { ...(await load(b.db)), cardio_min: 45, updated_at: '2026-10-08T11:00:00.000Z' });
    await b.sync();
    await saveWorkout(a.db, { ...(await load(a.db)), template: null, base: null, exercises: [], updated_at: '2026-10-08T12:00:00.000Z' });
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ template: null, exercises: [], version: 3 });
    expect((await load(a.db)).exercises).toEqual([]);
    expect(workoutPushes(server)).toHaveLength(3); // no merged copy was sent
  });

  it('a day whose first push was stored but its answer lost is not merged (it saw a server copy)', async () => {
    const { server, a, id } = await devices();
    await a.sync();
    await saveWorkout(a.db, cardioDay(30, '2026-10-08T11:00:00.000Z'));
    server.losePushResponses = 1;
    await a.sync(); // stored as v1; A still holds it at v0
    // Another device then stored a session and cleared the minutes (earlier clock, so this device's retry is the later edit).
    server.seed('workouts', { ...sessionDay('2026-10-08T10:30:00Z'), id, version: 2 });
    await a.sync(); // client_won, with the other copy as replaced_record
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 30, template: null });
    expect(workoutPushes(server)).toHaveLength(2);
    expect((await load(a.db)).template).toBeNull();
  });

  it('a deleted day on the other device is not brought back, and a day deleted here stays deleted', async () => {
    const { server, a, id } = await devices();
    await a.sync();
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1, deleted_at: '2026-10-08T10:00:00Z' });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await a.sync(); // client_won over a tombstone
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ deleted_at: null, template: 'Upper A', cardio_min: null });
    expect(workoutPushes(server)).toHaveLength(1);
  });

  it('a day deleted here is not merged with the live day it replaced', async () => {
    const { server, a, id } = await devices();
    await a.sync();
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1 });
    await saveWorkout(a.db, { ...sessionDay('2026-10-08T11:00:00.000Z'), deleted_at: '2026-10-08T11:00:00.000Z' });
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ deleted_at: '2026-10-08T11:00:00.000Z', cardio_min: null });
    expect((await load(a.db)).deleted_at).not.toBeNull();
    expect(workoutPushes(server)).toHaveLength(1);
  });

  it('a retry whose answer lacks replaced_record keeps today\'s behaviour: the server copy is adopted, nothing is merged', async () => {
    const { server, a, id } = await devices();
    await a.sync();
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1 });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    server.losePushResponses = 1;
    await a.sync(); // client_won, stored as v2; the answer (and replaced_record) is lost
    await a.sync(); // the retry resolves as an idempotent server_won
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: null, template: 'Upper A' });
    expect((await load(a.db)).cardio_min).toBeNull();
    expect(workoutPushes(server)).toHaveLength(2); // the push and its retry; no merged copy
  });

  it('a server without replaced_record (contract 0.1.19) keeps today\'s behaviour', async () => {
    const { server, a, id } = await devices();
    server.omitReplaced = true;
    await a.sync();
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1 });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await a.sync();
    await a.sync();
    expect((await load(a.db)).cardio_min).toBeNull();
    expect(workoutPushes(server)).toHaveLength(1);
  });

  it('the account changed while the request was in flight: nothing is merged, stored or queued', async () => {
    const { server, a, beforePush, id } = await devices();
    await a.sync();
    server.seed('workouts', { ...cardioDay(30, '2026-10-08T10:00:00Z'), id, version: 1 });
    await saveWorkout(a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await a.db.runAsync('DELETE FROM sync_outbox');
    const before = JSON.stringify(await load(a.db));
    await a.db.runAsync("INSERT INTO sync_outbox (tbl, key, queued_at) VALUES ('workouts', ?, 'x')", DATE);
    // A different account signed in (and the store was wiped) after the push left.
    beforePush(() => setKv(a.db, KEY_USER, OTHER));
    expect(await a.sync()).toMatchObject({ status: 'paused' });
    expect(JSON.stringify(await load(a.db))).toBe(before); // neither the server's copy nor the replaced one was written
    expect((await load(a.db)).cardio_min).toBeNull();
    expect(await a.db.getAllAsync("SELECT seq FROM sync_outbox WHERE tbl = 'workouts'")).toHaveLength(1); // only the entry that was there
  });
});

describe('server_won after the pre-pull (#792)', () => {
  /** A holds the day at the server's version after the pre-pull merge; another device stores a later edit before A pushes. */
  async function racing(first: Workout, mine: Workout, later: Partial<Workout>) {
    const d = await devices();
    await saveWorkout(d.b.db, first);
    await d.b.sync(); // v1 on the server
    await saveWorkout(d.a.db, mine);
    await saveSet(d.a.db, DATE, benchSet(mine.updated_at));
    d.beforePush(() => {
      d.server.seed('workouts', { ...first, ...later, id: d.id, version: 2 });
    });
    return d;
  }

  it('what this device added is merged into the later edit and sent', async () => {
    const { server, a, id } = await racing(cardioDay(30, '2026-10-08T10:00:00.000Z'), sessionDay('2026-10-08T10:30:00.000Z'), { cardio_min: 40, updated_at: '2026-10-08T12:00:00Z' });
    await a.sync(); // pre-pull merge (v1), then the push ends server_won
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 40, template: 'Upper A', version: 3 });
    expect(await shows(a.db)).toEqual({ ...BOTH, cardio: 40 });
  });

  it('a session removed by the later edit stays removed', async () => {
    const { server, a, id } = await racing(sessionDay('2026-10-08T10:00:00.000Z'), cardioDay(30, '2026-10-08T10:30:00.000Z'), { template: null, base: null, exercises: [], cardio_min: null, updated_at: '2026-10-08T12:00:00Z' });
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ template: null, exercises: [], cardio_min: 30 });
    expect((await load(a.db)).exercises).toEqual([]);
  });

  it('an exercise removed by the later edit stays removed while this device\'s own addition is kept', async () => {
    const two = { ...sessionDay('2026-10-08T10:00:00.000Z'), exercises: [bench, row] };
    const { server, a, id } = await racing(two, cardioDay(30, '2026-10-08T10:30:00.000Z'), { exercises: [bench], updated_at: '2026-10-08T12:00:00Z' });
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 30 });
    expect((server.get('workouts', id)?.exercises as { name: string }[]).map((e) => e.name)).toEqual(['Bench']);
  });

  it('a later edit that deleted the day is not merged', async () => {
    const { server, a, id } = await racing(cardioDay(30, '2026-10-08T10:00:00.000Z'), sessionDay('2026-10-08T10:30:00.000Z'), { deleted_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z' });
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ deleted_at: '2026-10-08T12:00:00Z' });
    expect(workoutPushes(server)).toHaveLength(2); // the other device's first push and the one that lost; no merged copy
  });

  it('a base kept for another version of the day is not used', async () => {
    const { server, a, id } = await devices();
    await saveWorkout(a.db, sessionDay('2026-10-08T09:00:00.000Z'));
    await a.sync();
    await saveWorkout(a.db, { ...(await load(a.db)), cardio_min: 30, updated_at: '2026-10-08T10:00:00.000Z' });
    await a.sync(); // A holds v2
    expect((await load(a.db)).version).toBe(2);
    await setBase(a.db, DATE, { ...sessionDay('2026-10-08T09:00:00.000Z'), version: 1 }); // left over from an older version of the row
    await saveWorkout(a.db, { ...(await load(a.db)), cardio_min: 35, updated_at: '2026-10-08T10:30:00.000Z' });
    server.seed('workouts', { ...sessionDay('2026-10-08T12:00:00Z'), id, version: 3 }); // stored elsewhere, later
    await a.sync(); // server_won
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: null, version: 3 });
    expect(workoutPushes(server)).toHaveLength(3); // the first push, the cardio edit and the one that lost
  });

  it('a pre-pull base is not used after a push of the merged day was stored but its answer lost', async () => {
    const { server, a, b, id } = await devices();
    await saveWorkout(b.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await b.sync();
    await saveWorkout(a.db, sessionDay('2026-10-08T10:30:00.000Z'));
    await saveSet(a.db, DATE, benchSet('2026-10-08T10:30:00.000Z'));
    server.losePushResponses = 1;
    await a.sync(); // merged at v1 with the base kept; stored as v2, answer lost
    await b.sync();
    await saveWorkout(b.db, { ...(await load(b.db)), template: null, base: null, where: null, mods: {}, exercises: [], ci_choice: null, updated_at: '2026-10-08T12:00:00.000Z' });
    await b.sync(); // v3
    await a.sync(); // server_won against v3
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ template: null, exercises: [] });
  });

  it('a base is cleared when the push settles', async () => {
    const { a, beforePush } = await devices();
    await saveWorkout(a.db, sessionDay('2026-10-08T10:00:00.000Z'));
    await a.sync();
    await saveWorkout(a.db, { ...(await load(a.db)), cardio_min: 30, updated_at: '2026-10-08T10:30:00.000Z' });
    beforePush(() => setBase(a.db, DATE, { ...sessionDay('2026-10-08T10:00:00.000Z'), version: 1 })); // written while the push is in flight
    await a.sync();
    expect(await getKv(a.db, `sync.base.workouts.${DATE}`)).toBeNull();
  });

  it('a second race on the merged day is merged too: the stored copy is its base', async () => {
    const { server, a, id, beforePush } = await racing(cardioDay(30, '2026-10-08T10:00:00.000Z'), sessionDay('2026-10-08T10:30:00.000Z'), { cardio_min: 40, updated_at: '2026-10-08T12:00:00Z' });
    await a.sync(); // pre-pull merge (v1); the push ends server_won against v2; the merged day is queued at v2
    expect(await getKv(a.db, `sync.base.workouts.${DATE}`)).not.toBeNull();
    beforePush(() => server.seed('workouts', { ...cardioDay(50, '2026-10-08T13:00:00Z'), id, version: 3 })); // a later edit, again before the push
    await a.sync(); // server_won again
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 50, template: 'Upper A', version: 4 });
  });

  it('a second race after a lost answer does not bring a removed session back', async () => {
    const { server, a, id } = await racing(cardioDay(30, '2026-10-08T10:00:00.000Z'), sessionDay('2026-10-08T10:30:00.000Z'), { cardio_min: 40, updated_at: '2026-10-08T12:00:00Z' });
    await a.sync(); // merged day queued at v2 with the stored copy as its base
    server.losePushResponses = 1;
    await a.sync(); // stored as v3, answer lost (the base went with the request)
    server.seed('workouts', { ...cardioDay(50, '2026-10-08T13:00:00Z'), id, version: 4 }); // the session is removed elsewhere
    await a.sync();
    await a.sync();
    expect(server.get('workouts', id)).toMatchObject({ template: null, exercises: [] });
  });

  it('a base is put back when the request is refused whole', async () => {
    const { server, a, b, id, beforePush } = await devices();
    await saveWorkout(b.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await b.sync();
    await saveWorkout(a.db, sessionDay('2026-10-08T10:30:00.000Z'));
    await saveSet(a.db, DATE, benchSet('2026-10-08T10:30:00.000Z'));
    beforePush(() => void server.force400.push(undefined));
    await a.sync(); // pre-pull merge keeps the base; the push is refused (400, nothing stored)
    expect(await getKv(a.db, `sync.base.workouts.${DATE}`)).not.toBeNull();
    await a.sync(); // pushed
    expect(server.get('workouts', id)).toMatchObject({ cardio_min: 30, template: 'Upper A' });
  });

  it('the account changed while the push was in flight: nothing is merged or queued', async () => {
    const { a, beforePush, server, id } = await devices();
    await saveWorkout(a.db, cardioDay(30, '2026-10-08T10:00:00.000Z'));
    await a.sync();
    await saveWorkout(a.db, sessionDay('2026-10-08T10:30:00.000Z'));
    const before = JSON.stringify(await load(a.db));
    beforePush(async () => {
      server.seed('workouts', { ...cardioDay(40, '2026-10-08T12:00:00Z'), id, version: 2 });
      await setKv(a.db, KEY_USER, OTHER);
    });
    expect(await a.sync()).toMatchObject({ status: 'paused' });
    expect(JSON.stringify(await load(a.db))).toBe(before); // the other copy was not stored
    expect(await getKv(a.db, `sync.base.workouts.${DATE}`)).toBeNull();
  });
});

describe('a refused request clears its sent marks (#792)', () => {
  async function refused() {
    const d = await devices();
    await d.a.sync();
    d.server.seed('workouts', { ...cardioDay(30, '2026-10-08T12:00:00Z'), id: d.id, version: 1 }); // later than A's day: server_won
    await saveWorkout(d.a.db, sessionDay('2026-10-08T11:00:00.000Z'));
    await saveSet(d.a.db, DATE, benchSet('2026-10-08T11:00:00.000Z'));
    return d;
  }

  it('a 400 that names another record: the day it carried still counts as never seen', async () => {
    const { server, a } = await refused();
    server.rejectIf = (table, r) => (table === 'weights' && (r.weight_kg as number) <= 0 ? 'weight_kg' : null);
    await saveWeightDoc(a.db, { id: null, version: 0, updated_at: '2026-10-08T06:00:00Z', deleted_at: null, date: DATE, weight_kg: -1 });
    await a.sync(); // refused whole, the weigh-in is set aside, the day goes again and ends server_won
    expect(await shows(a.db)).toEqual(BOTH);
  });

  it('a 400 that names no record: the day it carried still counts as never seen', async () => {
    const { server, a, beforePush } = await refused();
    beforePush(() => void server.force400.push(undefined));
    expect(await a.sync()).toMatchObject({ status: 'rejected' });
    await a.sync();
    expect(await shows(a.db)).toEqual(BOTH);
  });
});
