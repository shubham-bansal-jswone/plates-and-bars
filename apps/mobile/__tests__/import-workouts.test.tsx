import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KG_PER_LB } from '@plate-and-bar/core';
import { DataScreen } from '../src/screens/DataScreen';
import { SyncContext, type SyncState } from '../src/sync/SyncProvider';
import { SettingsProvider } from '../src/state/SettingsProvider';
import { IMPORT_COPY as t } from '../src/import/copy';
import { memoryDb } from './helpers';
import { loadSessionLog } from '../src/db/workouts';
import { planned } from '@plate-and-bar/core';

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
    expect(screen.getByText(t.range('2024-03-27', '2024-03-28'))).toBeTruthy();
    expect(screen.getByText(t.unitUsed('lb'))).toBeTruthy();
    expect(screen.getByText(t.matched(1))).toBeTruthy();
    expect(screen.getByText(t.unmatchedTitle(1))).toBeTruthy();
    expect(screen.getByText('Zottman Curl')).toBeTruthy();
    expect(screen.getByText(t.skipped(1, 1, 0, 0))).toBeTruthy();
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

  it('an imported day cannot change which session is suggested next (even titled like a real template)', async () => {
    const db = memoryDb();
    await setup(db);
    await open();
    const csv = [HEAD, '2024-03-26 18:00:00,Mystery,Bench Press (Barbell),1,60,5,0,0,,,', '2024-03-27 18:00:00,Pull A,Bench Press (Barbell),1,60,5,0,0,,,'].join('\n');
    await chooseFile(csv);
    await screen.findByText(t.previewTitle);
    await fireEvent.press(screen.getByLabelText(t.importBtn));
    await screen.findByText(t.imported(2, 2));
    const sessions = await loadSessionLog(db);
    expect(Object.values(sessions).map((e) => e.t)).toEqual(['Session', 'Session']);
    const profile = { days: 3 } as never;
    expect(planned('2024-04-01', { profile, sessions, mode: 'sequence' })).toBe(planned('2024-04-01', { profile, sessions: {}, mode: 'sequence' }));
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
});
