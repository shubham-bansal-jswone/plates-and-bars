import { exerciseRecord, mergeWorkout, unionWorkout, type ExState } from '../src/workout/model';
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

  it('an exercise removed on this device stays removed; one added elsewhere is kept', () => {
    const theirs = row([ex('Bench'), ex('Row'), ex('Curl'), ex('Squat')], { cardio_min: 20 });
    const mine = row([ex('Bench'), ex('Curl')]); // Row removed here
    const out = mergeWorkout(base, mine, theirs);
    expect(out.exercises.map((e) => e.name)).toEqual(['Bench', 'Curl', 'Squat']);
    expect(out.cardio_min).toBe(20);
  });
});

describe('exerciseRecord (#527)', () => {
  const state = (o: Partial<ExState> = {}): ExState => ({ name: 'Bench', part: 1, bridge: false, form: 'yes', found: 40, skipRamp: false, feel: null, sets: [], ramp: [], ...o });

  it('carries keys this client does not know through from the stored exercise', () => {
    const stored = { ...ex('Bench'), future_key: { a: 1 } } as WorkoutExercise;
    expect(exerciseRecord(state(), stored, stored)).toEqual({ ...ex('Bench', { form: 'yes', found_kg: 40 }), future_key: { a: 1 } });
  });

  it('known keys come from the screen, and a cleared feel is not kept', () => {
    const stored = ex('Bench', { form: 'no', feel: 'pain' });
    const out = exerciseRecord(state({ feel: null }), stored, stored);
    expect(out.form).toBe('yes');
    expect('feel' in out).toBe(false);
    expect(exerciseRecord(state({ feel: 'target' }), stored, stored).feel).toBe('target');
  });

  it('without a stored copy it writes the known keys only', () => {
    expect(exerciseRecord(state(), undefined, undefined)).toEqual(ex('Bench', { form: 'yes', found_kg: 40 }));
  });
});

describe('unionWorkout (#647)', () => {
  const cardio = (o: Partial<Workout> = {}) => row([], { template: null, base: null, cardio_min: 30, version: 1, updated_at: '2026-10-08T12:00:00Z', ...o });
  const session = (o: Partial<Workout> = {}) => row([ex('Bench')], { version: 0, updated_at: '2026-10-08T11:00:00Z', ...o });

  it('keeps the session and the minutes whichever row is later, at the server version', () => {
    for (const [mine, theirs] of [[session(), cardio()], [cardio({ version: 0 }), session({ version: 1, updated_at: '2026-10-08T13:00:00Z' })]] as const) {
      const out = unionWorkout(mine, theirs);
      expect([out.template, out.exercises.map((e) => e.name), out.version]).toEqual(['Upper A', ['Bench'], theirs.version]);
    }
    expect(unionWorkout(session(), cardio()).cardio_min).toBe(30);
  });

  it('two sessions: the later stands and the minutes from the other are kept', () => {
    const out = unionWorkout(session({ template: 'Lower', exercises: [ex('Squat')], updated_at: '2026-10-08T14:00:00Z' }), session({ cardio_min: 20, version: 3 }));
    expect([out.template, out.exercises.map((e) => e.name), out.cardio_min, out.version]).toEqual(['Lower', ['Squat'], 20, 3]);
  });
});
