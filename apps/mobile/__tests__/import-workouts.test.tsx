import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KG_PER_LB } from '@plate-and-bar/core';
import { DataScreen } from '../src/screens/DataScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { SettingsProvider } from '../src/state/SettingsProvider';
import { IMPORT_COPY as t } from '../src/import/copy';
import { memoryDb } from './helpers';
import { loadSessionLog } from '../src/db/workouts';
import { planned } from '@plate-and-bar/core';
import { saveSet, saveWorkout } from '../src/db/workouts';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
jest.mock('../src/account/saveFile', () => ({ clearOldExports: () => undefined, saveTextFile: async () => 'saved' }));
jest.mock('../src/account/exportLocal', () => ({ buildLocalExport: async () => ({ file: { exported_at: '2026-10-09T08:00:00.000Z' }, csv: '' }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
const mockPick = jest.fn();
jest.mock('../src/import/pickCsv', () => ({ pickCsv: () => mockPick() }));

const sync = {
  configured: true, signedIn: false, linked: false, wipePending: false, lastDeletion: null, clearLastDeletion: () => undefined, pending: 0, syncing: false, last: null, epoch: 0, dataVersion: 0, quarantined: 0, accountFull: false, signInUnavailable: false, retryQuarantined: async () => undefined, discardQuarantined: async () => undefined, holdSchedule: () => undefined,
  syncNow: async () => null, startSignIn: async () => ({ ok: true, resendAfterSec: 60 }), verifyCode: async () => ({ kind: 'signed_in', wiped: false }), signOut: async () => 0, discardAndSignOut: async () => undefined,
  exportFromServer: async () => ({ kind: 'not_signed_in' }), deleteEverything: async () => ({ kind: 'deleted', server: false, linked: false }),
} as unknown as SyncState;

const HEAD = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';
const STRONG = [
  HEAD,
  '2024-03-27 18:30:00,Push Day,Bench Press (Barbell),W,20,10,0,0,,,',
  '2024-03-27 18:30:00,Push Day,Bench Press (Barbell),1,135,5,0,0,,,',
  '2024-03-27 18:30:00,Push Day,Bench Press (Barbell),2,145,3,0,0,,,',
  '2024-03-27 18:30:00,Push Day,Zottman Curl,1,20,10,0,0,,,',
  '2024-03-27 18:30:00,Push Day,Running,1,0,0,3,900,,,',
  '2024-03-28 18:30:00,Pull Day,Bench Press (Barbell),1,100,5,0,0,,,',
].join('\n');

const setup = async (db = memoryDb()) => {
  await render(
    <SyncContext.Provider value={sync}>
      <SettingsProvider db={db}>
        <DataScreen db={db} />
      </SettingsProvider>
    </SyncContext.Provider>,
  );
  return db;
};
const open = () => fireEvent.press(screen.getByLabelText(t.open));
const chooseFile = async (text: string) => {
  mockPick.mockResolvedValueOnce({ kind: 'text', text });
  await fireEvent.press(screen.getByLabelText(t.choose));
};
const workoutRows = (db: ReturnType<typeof memoryDb>) => [...db.rows].filter(([k]) => k.startsWith('workouts:'));

beforeEach(() => mockPick.mockReset());

describe('import workouts (#1179)', () => {
  it('is on the Data screen with labelled controls', async () => {
    await setup();
    await open();
    expect(screen.getByLabelText(t.strong)).toBeTruthy();
    expect(screen.getByLabelText(t.hevy)).toBeTruthy();
    expect(screen.getByLabelText(t.choose)).toBeTruthy();
    expect(screen.getByLabelText(t.lb)).toBeTruthy();
  });

  it('previews a Strong file (matched, unmatched, skipped counts), then writes the days with sets in kg through the normal tables', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.lb));
    await chooseFile(STRONG);
    expect(await screen.findByText(t.workouts(2, 4))).toBeTruthy();
    expect(screen.getByText(t.range('27 Mar 2024', '28 Mar 2024'))).toBeTruthy();
    expect(screen.getByText(t.unitUsed('lb'))).toBeTruthy();
    expect(screen.getByText(t.matched(1))).toBeTruthy();
    expect(screen.getByText(t.unmatchedTitle(1))).toBeTruthy();
    expect(screen.getByText('Zottman Curl')).toBeTruthy();
    expect(screen.getByText(t.skipped(1, 1, 0, 0, 0, 0))).toBeTruthy();
    expect(workoutRows(db)).toHaveLength(0); // nothing is written by the preview

    await fireEvent.press(screen.getByLabelText(t.addLabel('Zottman Curl')));
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(await screen.findByText(t.imported(2, 4))).toBeTruthy();
    expect(screen.getByText(t.addedOwn(1))).toBeTruthy();

    expect(workoutRows(db).map(([k]) => k).sort()).toEqual(['workouts:2024-03-27', 'workouts:2024-03-28']);
    const w = JSON.parse(db.rows.get('workouts:2024-03-27')!);
    expect(w).toMatchObject({ date: '2024-03-27', template: 'Session', base: null, id: null, deleted_at: null });
    expect(w.exercises.map((e: { name: string }) => e.name)).toEqual(['Barbell Bench Press', 'Zottman Curl']);
    const sets = [...db.sets.values()].filter((s) => s.date === '2024-03-27').map((s) => JSON.parse(s.data));
    expect(sets).toHaveLength(3);
    expect(sets.map((s) => [s.exercise, s.set_index, s.reps, s.kind, s.done])).toEqual([
      ['Barbell Bench Press', 0, 5, 'work', true],
      ['Barbell Bench Press', 1, 3, 'work', true],
      ['Zottman Curl', 0, 10, 'work', true],
    ]);
    expect(sets[0].weight_kg).toBeCloseTo(135 * KG_PER_LB, 6);
    expect(JSON.parse(db.rows.get('user_settings:me') ?? '{}').custom_tags).toHaveProperty('Zottman Curl');
  });

  it('skips an unmatched exercise by default and says how many sets were left out', async () => {
    const db = await setup();
    await open();
    await chooseFile(STRONG);
    await screen.findByText(t.workouts(2, 4));
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(await screen.findByText(t.leftOutExercise(1))).toBeTruthy();
    expect([...db.sets.values()].map((s) => JSON.parse(s.data).exercise)).not.toContain('Zottman Curl');
    expect(db.rows.has('user_settings:me')).toBe(false);
  });

  it('never overwrites a day the app already has: it is skipped and reported, and the existing workout is untouched', async () => {
    const db = memoryDb();
    const mine = JSON.stringify({ id: null, version: 3, updated_at: '2024-03-27T20:00:00Z', deleted_at: null, date: '2024-03-27', template: 'Mine', base: 'Mine', where: null, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    db.rows.set('workouts:2024-03-27', mine);
    await setup(db);
    await open();
    await chooseFile(STRONG);
    expect(await screen.findByText(t.occupied(1))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(await screen.findByText(t.skippedDays(1))).toBeTruthy();
    expect(db.rows.get('workouts:2024-03-27')).toBe(mine);
    expect(workoutRows(db)).toHaveLength(2);
    expect([...db.sets.values()].every((s) => s.date === '2024-03-28')).toBe(true);
  });

  it('a workout that arrives between the preview and Import is not overwritten (the day is re-checked inside the transaction)', async () => {
    const db = memoryDb();
    await setup(db);
    await open();
    await chooseFile(STRONG);
    await screen.findByText(t.previewTitle);
    expect(screen.queryByText(t.occupied(1))).toBeNull();
    const arrived = JSON.stringify({ id: null, version: 3, updated_at: '2024-03-27T20:00:00Z', deleted_at: null, date: '2024-03-27', template: 'Mine', base: 'Mine', where: null, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    db.rows.set('workouts:2024-03-27', arrived);
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(await screen.findByText(t.skippedDays(1))).toBeTruthy();
    expect(db.rows.get('workouts:2024-03-27')).toBe(arrived);
    expect([...db.sets.values()].every((s) => s.date === '2024-03-28')).toBe(true);
  });

  it('an imported day cannot change which session is suggested next (even titled like a real template)', async () => {
    const db = memoryDb();
    await setup(db);
    await open();
    const real = JSON.stringify({ id: null, version: 1, updated_at: '2024-03-25T10:00:00Z', deleted_at: null, date: '2024-03-25', template: 'Push A', base: 'Push A', where: null, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    db.rows.set('workouts:2024-03-25', real);
    await saveSet(db, '2024-03-25', { id: 's0', version: 1, updated_at: '2024-03-25T10:00:00Z', deleted_at: null, workout_id: null, exercise: 'Lat Pulldown', kind: 'work', set_index: 0, weight_kg: 40, reps: 8, done: true, rate: null, t: null });
    const csv = [HEAD, '2024-03-26 18:00:00,Mystery,Bench Press (Barbell),1,60,5,0,0,,,', '2024-03-27 18:00:00,Pull A,Bench Press (Barbell),1,60,5,0,0,,,'].join('\n');
    await chooseFile(csv);
    await screen.findByText(t.previewTitle);
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    await screen.findByText(t.imported(2, 2));
    const sessions = await loadSessionLog(db);
    expect(Object.values(sessions).map((e) => e.t)).toEqual(['Push A', 'Session', 'Session']);
    const profile = { days: 6 } as never;
    expect(planned('2024-04-01', { profile, sessions, mode: 'sequence' })).toBe(planned('2024-04-01', { profile, sessions: { '2024-03-25': sessions['2024-03-25']! }, mode: 'sequence' }));
    expect(planned('2024-04-01', { profile, sessions, mode: 'sequence' })).toBe('Pull A');
  });

  it('imports a Hevy file in kg without asking for a unit', async () => {
    const db = await setup();
    await open();
    await fireEvent.press(screen.getByLabelText(t.hevy));
    expect(screen.queryByLabelText(t.lb)).toBeNull();
    const csv = [
      'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe',
      'Upper,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Bench Press (Barbell),,,0,warmup,20,10,,,',
      'Upper,"27 Mar 2024, 18:30","27 Mar 2024, 19:30",,Bench Press (Barbell),,,1,normal,60,8,,,',
    ].join('\n');
    await chooseFile(csv);
    expect(await screen.findByText(t.workouts(1, 1))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(await screen.findByText(t.imported(1, 1))).toBeTruthy();
    const set = JSON.parse([...db.sets.values()][0]!.data);
    expect([set.exercise, set.weight_kg, set.reps]).toEqual(['Barbell Bench Press', 60, 8]);
  });

  it('refuses a wrong file with a message and writes nothing', async () => {
    const db = await setup();
    await open();
    await chooseFile('a,b,c\n1,2,3');
    expect(await screen.findByText(t.badFile.not_recognised)).toBeTruthy();
    expect(screen.queryByText(t.previewTitle)).toBeNull();
    await chooseFile('');
    expect(await screen.findByText(t.badFile.empty)).toBeTruthy();
    mockPick.mockResolvedValueOnce({ kind: 'too_large' });
    await fireEvent.press(screen.getByLabelText(t.choose));
    expect(await screen.findByText(t.badFile.too_large)).toBeTruthy();
    expect(db.rows.size + db.sets.size).toBe(0);
  });

  it('does nothing when the picker is cancelled, and Import is disabled when every exercise is skipped', async () => {
    const db = await setup();
    await open();
    mockPick.mockResolvedValueOnce({ kind: 'cancelled' });
    await fireEvent.press(screen.getByLabelText(t.choose));
    expect(screen.getByLabelText(t.choose)).toBeTruthy();
    const only = [HEAD, '2024-03-27 18:30:00,A,Zottman Curl,1,20,10,0,0,,,'].join('\n');
    await chooseFile(only);
    expect(await screen.findByText(t.nothing)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(db.rows.size + db.sets.size).toBe(0);
    await waitFor(() => expect(screen.getByLabelText(t.importBtn)).toBeTruthy());
  });

  it('a failed write is reported and leaves the screen usable', async () => {
    const db = await setup();
    await open();
    await chooseFile(STRONG);
    await screen.findByText(t.previewTitle);
    db.failWrites = true;
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    expect(await screen.findByText(t.failed)).toBeTruthy();
  });
  it('over a deleted workout, the live sets it left are tombstoned so none shows inside the imported day', async () => {
    const db = memoryDb();
    await saveWorkout(db, { id: null, version: 4, updated_at: '2024-03-20T10:00:00Z', deleted_at: '2024-03-20T10:00:00Z', date: '2024-03-27', template: 'Mine', base: null, where: null, cardio_min: null, mods: {}, exercises: [], ci_choice: null });
    await saveSet(db, '2024-03-27', { id: 'old', version: 2, updated_at: '2024-03-20T10:00:00Z', deleted_at: null, workout_id: null, exercise: 'Deadlift', kind: 'work', set_index: 0, weight_kg: 100, reps: 3, done: true, rate: null, t: null });
    await setup(db);
    await open();
    await chooseFile(STRONG);
    await screen.findByText(t.previewTitle);
    expect(screen.queryByText(t.occupied(1))).toBeNull(); // a deleted workout does not block the day
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    await screen.findByText(t.imported(2, 4 - 1)); // the unmatched exercise is skipped
    const old = JSON.parse(db.sets.get('old')!.data);
    expect(old.deleted_at).not.toBeNull();
    expect(db.sets.get('old')!.deleted).toBe(1);
    expect(JSON.parse(db.rows.get('workouts:2024-03-27')!)).toMatchObject({ deleted_at: null, version: 4, template: 'Session' });
  });

  it('matches an unmatched exercise to a library exercise so its sets join the existing lift', async () => {
    const db = await setup();
    await open();
    await chooseFile([HEAD, '2024-03-27 18:30:00,A,Squat (Barbell),1,100,5,0,0,,,'].join('\n'));
    await screen.findByText(t.unmatchedTitle(1));
    await fireEvent.press(screen.getByLabelText(t.matchLabel('Squat (Barbell)')));
    await fireEvent.changeText(screen.getByLabelText(t.pickerSearch), 'back squat');
    await fireEvent.press(screen.getByLabelText(t.pickerPick('Barbell Back Squat')));
    expect(screen.getByLabelText(t.matchedToLabel('Squat (Barbell)', 'Barbell Back Squat'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    await screen.findByText(t.imported(1, 1));
    expect(JSON.parse([...db.sets.values()][0]!.data).exercise).toBe('Barbell Back Squat');
    expect(db.rows.has('user_settings:me')).toBe(false); // no duplicate custom exercise
  });

  it('shows the question as visible text, and lists the days it will skip', async () => {
    const db = memoryDb();
    db.rows.set('workouts:2024-03-27', JSON.stringify({ id: null, version: 1, updated_at: '2024-03-27T10:00:00Z', deleted_at: null, date: '2024-03-27', template: null, base: null, where: null, cardio_min: 20, mods: {}, exercises: [], ci_choice: null }));
    await setup(db);
    await open();
    expect(screen.getByText(t.appLabel)).toBeTruthy();
    await chooseFile(STRONG);
    expect(await screen.findByText(t.occupiedDates('27 Mar 2024'))).toBeTruthy(); // a cardio-only day blocks its date too
  });

  it('turns away rows dated in the future and says so in the preview', async () => {
    await setup();
    await open();
    await chooseFile([HEAD, '2024-03-27 18:30:00,A,Bench Press (Barbell),1,60,5,0,0,,,', '2999-01-01 10:00:00,A,Bench Press (Barbell),1,60,5,0,0,,,'].join('\n'));
    expect(await screen.findByText(t.skipped(0, 0, 0, 0, 0, 1))).toBeTruthy();
  });
});
