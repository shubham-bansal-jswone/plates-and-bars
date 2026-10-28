import { saveProfile } from '../src/db/records';
import { saveWorkout, saveSet } from '../src/db/workouts';
import { loadWidgetData, widgetData, type WidgetInput } from '../src/widget/data';
import { widgetLines } from '../src/widget/WorkoutWidget';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout, WorkoutSet } from '../src/workout/types';
import { memoryDb } from './helpers';

const THURSDAY = new Date(2026, 9, 8, 9, 0); // a 6-day plan trains Thursday
const SUNDAY = new Date(2026, 9, 11, 9, 0); // Sundays are rest
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

const ex = (name: string) => ({ name, part: 1 as const, bridge: false, form: null, found_kg: null, skip_ramp: false });
const workout = (date: string, names: string[], over: Partial<Workout> = {}): Workout => ({
  id: null, version: 1, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, date, template: 'Push B', base: 'Push B', where: 'gym', cardio_min: null, mods: {}, exercises: names.map(ex), ci_choice: null, ...over,
});
const set = (exercise: string, i: number, done: boolean): WorkoutSet => ({
  id: `${exercise}-${i}`, version: 1, updated_at: '2026-10-08T08:00:00Z', deleted_at: null, workout_id: null, exercise, kind: 'work', set_index: i, weight_kg: null, reps: null, done, rate: null, t: null,
});
const base: WidgetInput = { hasProfile: true, plan: 'Push B', stored: null, sets: [], planned: ['Barbell Bench Press', 'Pec Deck Fly'] };

describe('widgetData', () => {
  it('is empty before setup', () => {
    expect(widgetData({ ...base, hasProfile: false })).toEqual({ kind: 'empty' });
  });
  it('shows a rest day when nothing is planned or stored', () => {
    expect(widgetData({ ...base, plan: null, planned: [] })).toEqual({ kind: 'rest' });
  });
  it('shows the planned day, its exercise count and the first exercise before a session starts', () => {
    expect(widgetData(base)).toEqual({ kind: 'workout', title: 'Push B', count: 2, next: 'Barbell Bench Press' });
  });
  it('ignores a cardio-only day and a deleted session', () => {
    const cardio = workout('2026-10-08', [], { template: null, base: null, cardio_min: 20 });
    expect(widgetData({ ...base, stored: cardio })).toMatchObject({ title: 'Push B', count: 2 });
    expect(widgetData({ ...base, plan: null, planned: [], stored: workout('2026-10-08', ['Pec Deck Fly'], { deleted_at: '2026-10-08T09:00:00Z' }) })).toEqual({ kind: 'rest' });
  });
  it('uses the stored session: next is the first exercise with a work set still open', () => {
    const stored = workout('2026-10-08', ['A', 'B', 'C']);
    const sets = [set('A', 0, true), set('B', 0, true), set('B', 1, false), set('C', 0, false)];
    expect(widgetData({ ...base, stored, sets })).toEqual({ kind: 'workout', title: 'Push B', count: 3, next: 'B' });
  });
  it('says all done (next null) when every work set is ticked, and ignores ramp and deleted sets', () => {
    const stored = workout('2026-10-08', ['A']);
    const sets = [set('A', 0, true), { ...set('A', 1, false), kind: 'ramp' as const }, { ...set('A', 2, false), deleted_at: '2026-10-08T09:00:00Z' }];
    expect(widgetData({ ...base, stored, sets })).toEqual({ kind: 'workout', title: 'Push B', count: 1, next: null });
  });
  it('a hand-picked session on a rest day shows as a workout titled Session', () => {
    const stored = workout('2026-10-11', ['A'], { template: null, base: null });
    expect(widgetData({ ...base, plan: null, planned: [], stored })).toMatchObject({ kind: 'workout', title: 'Session', count: 1, next: 'A' });
  });
  it('carries workout names and counts only', () => {
    expect(Object.keys(widgetData(base)).sort()).toEqual(['count', 'kind', 'next', 'title']);
  });
});

describe('widgetLines', () => {
  it('words each state', () => {
    expect(widgetLines({ kind: 'rest' })).toEqual({ title: 'Rest day', detail: 'Nothing planned today' });
    expect(widgetLines({ kind: 'empty' }).detail).toMatch(/Open the app/);
    expect(widgetLines({ kind: 'workout', title: 'Push B', count: 1, next: 'Pec Deck Fly' }).detail).toBe('1 exercise. Next: Pec Deck Fly');
    expect(widgetLines({ kind: 'workout', title: 'Push B', count: 5, next: null }).detail).toBe('5 exercises. All done for today');
  });
});

describe('loadWidgetData (SQLite only)', () => {
  it('is empty with no profile', async () => {
    expect(await loadWidgetData(memoryDb(), THURSDAY)).toEqual({ kind: 'empty' });
  });
  it('builds the planned day from core when nothing is stored', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    expect(await loadWidgetData(db, THURSDAY)).toEqual({ kind: 'workout', title: 'Push B', count: 5, next: 'Barbell Bench Press' });
  });
  it('is a rest day on Sunday', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    expect(await loadWidgetData(db, SUNDAY)).toEqual({ kind: 'rest' });
  });
  it('follows a stored session and its ticks', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveWorkout(db, workout('2026-10-08', ['Pec Deck Fly', 'Cable Lateral Raise']));
    await saveSet(db, '2026-10-08', set('Pec Deck Fly', 0, true));
    await saveSet(db, '2026-10-08', set('Cable Lateral Raise', 0, false));
    expect(await loadWidgetData(db, THURSDAY)).toEqual({ kind: 'workout', title: 'Push B', count: 2, next: 'Cable Lateral Raise' });
  });
  it('is empty when the database cannot be read', async () => {
    const db = memoryDb();
    db.getFirstAsync = () => Promise.reject(new Error('locked'));
    expect(await loadWidgetData(db, THURSDAY)).toEqual({ kind: 'empty' });
  });
});
