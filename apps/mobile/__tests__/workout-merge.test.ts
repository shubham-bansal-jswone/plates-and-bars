import { mergeWorkout } from '../src/workout/model';
import type { Workout, WorkoutExercise } from '../src/workout/types';

const ex = (name: string, o: Partial<WorkoutExercise> = {}): WorkoutExercise => ({ name, part: 1, bridge: false, form: null, found_kg: null, skip_ramp: false, ...o });
const row = (exercises: WorkoutExercise[], o: Partial<Workout> = {}): Workout => ({
  id: null, version: 2, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date: '2026-10-08', template: 'Upper A', base: 'Upper A', where: null, cardio_min: null,
  mods: { deload: false, light: false, reentry: 0, short: false, where: 'gym' }, exercises, ci_choice: null, ...o,
});

describe('mergeWorkout (#410)', () => {
  const base = row([ex('Bench'), ex('Row'), ex('Curl')]);

  it('keeps a swap stored elsewhere and the form answer given here', () => {
    const theirs = row([ex('Floor Press'), ex('Row'), ex('Curl')], { updated_at: '2026-10-08T09:00:00Z', version: 3 });
    const mine = row([ex('Bench'), ex('Row', { form: 'yes' }), ex('Curl')]);
    expect(mergeWorkout(base, mine, theirs).exercises).toEqual([ex('Floor Press'), ex('Row', { form: 'yes' }), ex('Curl')]);
  });

  it('appends exercises added here and does not bring back ones removed elsewhere', () => {
    const theirs = row([ex('Row'), ex('Curl')]);
    const mine = row([ex('Bench'), ex('Row'), ex('Curl'), ex('Squat', { part: 2 })], { template: 'Upper A + Legs' });
    const out = mergeWorkout(base, mine, theirs);
    expect(out.exercises.map((e) => e.name)).toEqual(['Row', 'Curl', 'Squat']);
    expect(out.template).toBe('Upper A + Legs');
  });

  it('a field changed only elsewhere keeps the stored value; the stored version and stamp are kept', () => {
    const theirs = row([ex('Bench', { found_kg: 40 }), ex('Row'), ex('Curl')], { cardio_min: 20, version: 5, updated_at: '2026-10-08T09:00:00Z' });
    const mine = row([ex('Bench', { skip_ramp: true }), ex('Row'), ex('Curl')]);
    const out = mergeWorkout(base, mine, theirs);
    expect(out.exercises[0]).toEqual(ex('Bench', { found_kg: 40, skip_ramp: true }));
    expect(out).toMatchObject({ cardio_min: 20, version: 5, updated_at: '2026-10-08T09:00:00Z' });
  });

  it('the same field changed on both sides: this device wins', () => {
    const theirs = row([ex('Bench', { form: 'no' }), ex('Row'), ex('Curl')]);
    const mine = row([ex('Bench', { form: 'yes' }), ex('Row'), ex('Curl')]);
    expect(mergeWorkout(base, mine, theirs).exercises[0]?.form).toBe('yes');
  });
});
