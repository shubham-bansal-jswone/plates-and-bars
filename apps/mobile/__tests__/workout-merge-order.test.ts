import { fixGroups, mergeWorkout } from '../src/workout/model';
import type { Workout, WorkoutExercise } from '../src/workout/types';

const ex = (name: string, group?: string | null): WorkoutExercise => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...(group === undefined ? {} : { group }) });
const row = (exercises: WorkoutExercise[]): Workout => ({
  id: null, version: 2, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date: '2026-10-08', template: 'Upper A', base: 'Upper A', where: null, cardio_min: null,
  mods: { deload: false, light: false, reentry: 0, short: false, where: 'gym' }, exercises, ci_choice: null,
});
const view = (w: Workout) => w.exercises.map((e) => `${e.name}${e.group ? ':' + e.group : ''}`);
const list = (s: string): WorkoutExercise[] => s.split(' ').map((t) => { const [n, g] = t.split(':'); return ex(n as string, g); });

/** The merge before #1331: this device's new exercises appended at the end. */
function oldMerge(base: Workout, mine: Workout, theirs: Workout): string[] {
  const b = new Set(base.exercises.map((e) => e.name)), m = new Set(mine.exercises.map((e) => e.name)), t = new Set(theirs.exercises.map((e) => e.name));
  return [...theirs.exercises.filter((e) => m.has(e.name) || !b.has(e.name)), ...mine.exercises.filter((e) => !t.has(e.name) && !b.has(e.name))].map((e) => e.name);
}

describe('mergeWorkout order (#1331)', () => {
  it('a group around a new exercise survives the other device appending (the issue example)', () => {
    const base = row(list('A B C'));
    const out = mergeWorkout(base, row(list('A B C:g D:g')), row(list('A B C E')));
    expect(view(out)).toEqual(['A', 'B', 'C:g', 'D:g', 'E']);
  });
  it('both devices add at different positions', () => {
    const base = row(list('A B C'));
    const out = mergeWorkout(base, row(list('A X B C')), row(list('A B C Y')));
    expect(view(out)).toEqual(['A', 'X', 'B', 'C', 'Y']);
  });
  it('a new exercise with no earlier survivor goes to the front; chained new ones keep their order', () => {
    const base = row(list('A B'));
    expect(view(mergeWorkout(base, row(list('N M A B')), row(list('A B'))))).toEqual(['N', 'M', 'A', 'B']);
    expect(view(mergeWorkout(base, row(list('A N M B')), row(list('A B Z'))))).toEqual(['A', 'N', 'M', 'B', 'Z']);
  });
  it('the predecessor skips an exercise removed on the other device', () => {
    const base = row(list('A B C'));
    expect(view(mergeWorkout(base, row(list('A B N C')), row(list('A C'))))).toEqual(['A', 'N', 'C']);
  });

  it('ungrouped merges with no concurrent additions are the same as the old append', () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let run = 0; run < 300; run++) {
      const all = Array.from({ length: 6 }, (_, i) => `E${i}`);
      const base = row(all.slice(0, 2 + rnd(5)).map((n) => ex(n)));
      const keep = (w: Workout) => w.exercises.filter(() => rnd(4) > 0);
      const mine = row([...keep(base), ...Array.from({ length: rnd(3) }, (_, i) => ex(`N${i}`))]);
      const theirs = row(keep(base));
      expect(view(mergeWorkout(base, mine, theirs))).toEqual(oldMerge(base, mine, theirs));
    }
  });

  it('two devices converge in at most 3 rounds, with no churn once settled', () => {
    // The server holds one copy. Device c pushed first. Device a (stale base) merges with the server and pushes; c then pulls.
    const base = row(list('A B C'));
    let server = row(list('A B C E'));
    let a = row(list('A B C:g D:g')), aBase = base, c = server, cBase = server, rounds = 0;
    for (; rounds < 3; rounds++) {
      const before = view(server);
      // device a: merges when the server moved past its base, then pushes its list
      const merged = aBase !== server ? mergeWorkout(aBase, a, server) : a;
      a = merged; aBase = merged; server = merged;
      // device c: nothing of its own to merge once it has pulled; it adopts the server copy
      c = server; cBase = server;
      if (view(server).join() === before.join()) break;
    }
    expect(rounds).toBeLessThanOrEqual(3);
    expect(view(server)).toEqual(['A', 'B', 'C:g', 'D:g', 'E']);
    // settled: another merge round on either side changes nothing
    expect(view(mergeWorkout(aBase, a, server))).toEqual(view(server));
    expect(view(mergeWorkout(cBase, c, server))).toEqual(view(server));
    expect(fixGroups(server.exercises)).toEqual(server.exercises);
  });
});
