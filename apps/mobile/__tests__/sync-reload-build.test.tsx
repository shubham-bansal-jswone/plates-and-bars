import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWorkoutDay } from '../src/workout/useWorkoutDay';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { openDb } from './sync-helpers';

jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const notify = jest.fn();
type Db = Awaited<ReturnType<typeof openDb>>;
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const micro = async (n: number) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Every list read made while armed is held (after it has read its rows) until `releaseAt` lets it go: the reads of a reload and of a session build overlap. */
function holding(db: Db) {
  const held: { mark: 'reload' | 'build'; go: () => void }[] = [];
  let mark: 'reload' | 'build' = 'reload';
  let armed = false;
  const wrapped = Object.assign(Object.create(db) as Db, {
    getAllAsync: async (...a: Parameters<Db['getAllAsync']>) => {
      const rows = await db.getAllAsync(...a);
      if (!armed) return rows;
      const m = mark;
      await new Promise<void>((go) => held.push({ mark: m, go }));
      return rows;
    },
  });
  return {
    db: wrapped,
    arm: (m: 'reload' | 'build') => {
      armed = true;
      mark = m;
    },
    count: (m: 'reload' | 'build') => held.filter((h) => h.mark === m).length,
    /** Lets the reload's reads go, then the build's reads `offset` microtasks later (negative: the other way round). */
    release: async (offset: number) => {
      const first = offset >= 0 ? 'reload' : 'build';
      held.filter((h) => h.mark === first).forEach((h) => h.go());
      await micro(Math.abs(offset));
      held.filter((h) => h.mark !== first).forEach((h) => h.go());
      armed = false;
    },
  };
}

const OFFSETS = [0, 1, 2, 3, 5, 8, 13, 25, -1, -2, -3, -5, -8, -13, -25];

async function setupDay(real: Db, h: ReturnType<typeof holding>) {
  const opts = { db: h.db, profile, now: NOW, focus: [], notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
  const hook = await renderHook(({ k }: { k: number }) => useWorkoutDay({ ...opts, reloadKey: k }), { initialProps: { k: 0 } });
  await waitFor(() => expect(hook.result.current.day.ready).toBe(true));
  return hook;
}

describe('a reload that overlaps a session being built never replaces the built session', () => {
  it.each(OFFSETS)('start: reads released %i microtasks apart', async (offset) => {
    const real = await openDb();
    const h = holding(real);
    const { result, rerender } = await setupDay(real, h);
    h.arm('reload');
    await rerender({ k: 1 });
    await waitFor(() => expect(h.count('reload')).toBeGreaterThan(0));
    h.arm('build');
    let started!: Promise<void>;
    await act(async () => {
      started = result.current.start('Upper A', {}, null);
      await waitFor(() => expect(h.count('build')).toBeGreaterThan(0));
      await h.release(offset);
      await started;
    });
    await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
    expect(result.current.day.workout?.base).toBe('Upper A');
    expect(result.current.day.exs.length).toBeGreaterThan(0);
    const rows = await real.getAllAsync<{ key: string }>('SELECT key FROM workout_sets');
    expect(rows.length).toBe(result.current.day.exs.reduce((n, e) => n + e.sets.length, 0));
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(OFFSETS)('addSecond: reads released %i microtasks apart', async (offset) => {
    const real = await openDb();
    const h = holding(real);
    const { result, rerender } = await setupDay(real, h);
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    const first = result.current.day.exs.length;
    h.arm('reload');
    await rerender({ k: 1 });
    await waitFor(() => expect(h.count('reload')).toBeGreaterThan(0));
    h.arm('build');
    await act(async () => {
      const added = result.current.addSecond('Lower A');
      await waitFor(() => expect(h.count('build')).toBeGreaterThan(0));
      await h.release(offset);
      await added;
    });
    await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
    expect(result.current.day.exs.length).toBeGreaterThan(first);
    const rows = await real.getAllAsync<{ key: string }>('SELECT key FROM workout_sets');
    expect(rows.length).toBe(result.current.day.exs.reduce((n, e) => n + e.sets.length, 0));
  });
});

describe("the can't-do answer when the rules could not be saved", () => {
  it('stops: today’s session is unchanged and nothing is written', async () => {
    const real = await openDb();
    const h = holding(real);
    const opts = { db: h.db, profile, now: NOW, focus: [], notify, startRest: jest.fn(), exclusions: [], swaps: [], saveRule: jest.fn(() => null), tune: {} } as unknown as Parameters<typeof useWorkoutDay>[0];
    const { result } = await renderHook(() => useWorkoutDay(opts));
    await waitFor(() => expect(result.current.day.ready).toBe(true));
    await act(async () => void (await result.current.start('Upper A', {}, null)));
    const before = JSON.stringify(result.current.day.exs);
    const rowsBefore = await real.getAllAsync('SELECT data FROM workout_sets');
    const name = result.current.day.exs[0]!.name;
    await act(async () => result.current.cant(0, { name, reason: 'dislike', dur: 'perm', scope: 'exercise', key: name }, null));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(opts.saveRule).toHaveBeenCalled();
    expect(JSON.stringify(result.current.day.exs)).toBe(before);
    expect(await real.getAllAsync('SELECT data FROM workout_sets')).toEqual(rowsBefore);
  });
});
