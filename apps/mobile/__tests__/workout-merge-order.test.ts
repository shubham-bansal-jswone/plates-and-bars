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

  // The real flow (ADR 007): a push is version-checked; on a conflict the device merges with the server copy and pushes the
  // merged result back at the server's version; a clean device pulls. Runs until both outboxes are empty.
  function converge(base: Workout, aList: string, cList: string) {
    const server = { w: base, v: 1 };
    const mk = (l: string) => ({ mine: row(list(l)), base, baseV: 1 });
    const devs = [mk(cList), mk(aList)]; // c pushes first, so a is the one that conflicts
    let rounds = 0;
    const pending = () => devs.some((d) => view(d.mine).join() !== view(d.base).join() || d.baseV !== server.v);
    while (pending() && rounds < 10) {
      rounds++;
      for (const d of devs) {
        if (view(d.mine).join() !== view(d.base).join()) {
          if (d.baseV !== server.v) d.mine = mergeWorkout(d.base, d.mine, server.w);
          if (view(d.mine).join() !== view(server.w).join()) { server.w = d.mine; server.v++; }
          d.base = server.w; d.baseV = server.v; d.mine = server.w;
        } else if (d.baseV !== server.v) { d.base = d.mine = server.w; d.baseV = server.v; }
      }
    }
    return { rounds, server, devs };
  }

  it.each([
    ['the issue example', 'A B C', 'A B C:g D:g', 'A B C E', ['A', 'B', 'C:g', 'D:g', 'E']],
    ['a grouped variant', 'A B C:g D:g', 'A B C:g D:g X:g', 'A B C:g D:g Y:g', null],
  ])('two devices adding after the same predecessor converge: %s', (_n, baseL, aL, cL, expected) => {
    const { rounds, server, devs } = converge(row(list(baseL)), aL, cL);
    expect(rounds).toBeLessThanOrEqual(3);
    expect(view(devs[0]!.mine)).toEqual(view(devs[1]!.mine));
    expect(view(devs[0]!.mine)).toEqual(view(server.w));
    expect(devs.every((d) => view(d.mine).join() === view(d.base).join() && d.baseV === server.v)).toBe(true); // outbox empty
    if (expected) expect(view(server.w)).toEqual(expected);
    else { expect(view(server.w).sort()).toEqual(['A', 'B', 'C:g', 'D:g', 'X:g', 'Y:g'].sort()); expect(fixGroups(server.w.exercises)).toEqual(server.w.exercises); } // one group, not split
    expect(fixGroups(server.w.exercises)).toEqual(server.w.exercises);
  });
});
