import { AccessibilityInfo, Platform } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { addDays } from '@plate-and-bar/core';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveProfile } from '../src/db/records';
import { saveLog, saveDayNote } from '../src/db/food';
import { saveWeight } from '../src/db/progress';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { WEEK_LOADING } from '../src/progress/copy';
import { PHOTOS_NEW } from '../src/photos/copy';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
// An in-memory photo vault: the photos stay on the real today, whatever day the bar shows.
const mockPhotos = new Set<string>();
jest.mock('../src/photos/vault', () => ({
  POSES: ['front', 'side', 'back'],
  persistent: true,
  putPhoto: async () => undefined,
  getPhoto: async (d: string, p: string) => (mockPhotos.has(`${d}|${p}`) ? 'AAAA' : null),
  deletePhoto: async () => undefined,
  onPhotosWiped: () => () => undefined,
  photoDates: async () => [...new Set([...mockPhotos].map((k) => k.split('|')[0]))].sort(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // Thursday
const TODAY = '2026-10-08';
const YESTERDAY = '2026-10-07';

const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
async function setup(db: Db = memoryDb()) {
  await saveProfile(db, profile());
  await render(withProfile(db, <ProgressScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Progress' });
  return db;
}
const back = async () => fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
const forward = async () => fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const meal = (date: string, n: number, kcal: number) => ({ id: `m-${date}-${n}`, version: 0, updated_at: `${date}T00:00:00Z`, deleted_at: null, date, meal: 'Lunch' as const, name: 'Dal', qty: 1, kcal, protein_g: 40, carbs_g: 100, fat_g: 20, food_id: null });

describe('Progress date navigation', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('shows Today, then Yesterday, with next off at today', async () => {
    await setup();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' }).props.accessibilityState).toMatchObject({ disabled: true });
    await back();
    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Wednesday, 7 Oct')).toBeTruthy();
    expect(screen.getByText('Seven days to 8 Oct')).toBeTruthy();
    await forward();
    expect(await screen.findByText('Today')).toBeTruthy();
  });

  it('keeps "Seven days" on the real current week while a past day is viewed (#1123)', async () => {
    const db = memoryDb();
    await saveLog(db, { id: 'w-today', version: 0, updated_at: `${TODAY}T00:00:00Z`, deleted_at: null, date: TODAY, meal: 'Lunch', name: 'Dal', qty: 1, kcal: 1234, protein_g: 40, carbs_g: 100, fat_g: 20, food_id: null } as never);
    await setup(db);
    await back();
    await screen.findByText('Yesterday');
    expect(screen.getByText('Seven days to 8 Oct')).toBeTruthy();
    expect(await screen.findByText('1,234 kcal')).toBeTruthy(); // today's bar, though yesterday is viewed
    expect(screen.getByLabelText('Thu, 1,234 kcal, 40 g protein')).toBeTruthy();
  });

  it('a weigh-in saved on a past day is that day’s, not today’s, and the form shows each day’s own value', async () => {
    const db = await setup();
    await back();
    await screen.findByText('Yesterday');
    await fireEvent.changeText(screen.getByLabelText('Weight in kg'), '81.4');
    await fireEvent.press(screen.getByLabelText('Save weight'));
    await waitFor(() => expect(docs(db, 'weights')).toEqual([expect.objectContaining({ date: YESTERDAY, weight_kg: 81.4 })]));
    await forward();
    await screen.findByText('Today');
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('');
    await back();
    await screen.findByText('Yesterday');
    expect(screen.getByLabelText('Weight in kg').props.value).toBe('81.4');
  });

  it('measurements and steps and sleep go to the viewed day; the tape button names the day', async () => {
    const db = await setup();
    expect(screen.getByLabelText('Save for today')).toBeTruthy();
    await back();
    await screen.findByText('Yesterday');
    expect(screen.queryByLabelText('Save for today')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Waist (at navel) in cm'), '90');
    await fireEvent.press(screen.getByLabelText('Save for 7 Oct'));
    await waitFor(() => expect(docs(db, 'measurements')).toEqual([expect.objectContaining({ date: YESTERDAY })]));
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '9100');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ date: YESTERDAY, steps: 9100 })]));
  });

  it('shows Loading, not the other day’s numbers, while a day is read, and a save then cannot land on stale rows', async () => {
    const db = await setup();
    await saveWeight(db, { id: null, version: 0, updated_at: `${YESTERDAY}T00:00:00Z`, deleted_at: null, date: YESTERDAY, weight_kg: 80.5 });
    await back();
    await screen.findByText('Latest: 80.5 kg');
    const read = db.getAllAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM weights')) await gate;
      return read(sql, ...p);
    }) as typeof db.getAllAsync;
    await forward();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText('Save weight')).toBeNull();
    expect(screen.getByText('Today')).toBeTruthy();
    await act(async () => open());
    expect(await screen.findByLabelText('Save weight')).toBeTruthy();
  });

  it('keeps the check-in week on the viewed day while its days are read: Loading in the week card, not the other day’s bars', async () => {
    const db = await setup();
    await screen.findAllByLabelText(/not logged|kcal/); // today's week has loaded
    const read = db.getFirstAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getFirstAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM workouts')) await gate; // only the 21-day check-in read goes through here
      return read(sql, ...p);
    }) as typeof db.getFirstAsync;
    await back();
    expect(await screen.findByText('Seven days to 8 Oct')).toBeTruthy();
    expect(screen.getByText(WEEK_LOADING)).toBeTruthy();
    expect(screen.queryByLabelText(/not logged|kcal/)).toBeNull();
    await act(async () => open());
    await waitFor(() => expect(screen.queryByText(WEEK_LOADING)).toBeNull());
    expect(screen.getAllByLabelText(/not logged|kcal/).length).toBeGreaterThan(0);
  });

  it('photos stay on the real today when a past day is viewed', async () => {
    mockPhotos.clear();
    mockPhotos.add(`${TODAY}|front`);
    await setup();
    expect(await screen.findByText(PHOTOS_NEW(true))).toBeTruthy();
    await back();
    await screen.findByText('Yesterday');
    expect(screen.getByText(PHOTOS_NEW(true))).toBeTruthy(); // not 'New photo check-in': today's photo is still today's
    mockPhotos.clear();
  });

  describe('announcement', () => {
    const slowWeights = (db: Db) => {
      const read = db.getAllAsync.bind(db);
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('FROM weights')) await gate;
        return read(sql, ...p);
      }) as typeof db.getAllAsync;
      return open;
    };

    it('on iOS, announces once per change and not on the first show; the live region stays empty', async () => {
      Platform.OS = 'ios';
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear();
      const db = await setup();
      expect(announce).not.toHaveBeenCalled();
      const open = slowWeights(db);
      await back();
      await act(async () => open());
      await screen.findByText('Wednesday, 7 Oct');
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Yesterday, Wednesday, 7 Oct');
      expect(screen.getByTestId('date-announce')).toHaveTextContent('');
      announce.mockRestore();
    });

    it.each(['android', 'web'] as const)('on %s, one polite live region outside the loading swap says it once', async (os) => {
      Platform.OS = os;
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear();
      const db = await setup();
      const region = screen.getByTestId('date-announce');
      expect(region).toHaveTextContent('');
      const open = slowWeights(db);
      await back();
      expect(screen.getByText('Loading…')).toBeTruthy();
      await act(async () => open());
      await screen.findByText('Wednesday, 7 Oct');
      expect(screen.getAllByTestId('date-announce')).toHaveLength(1);
      expect(screen.getByTestId('date-announce')).toBe(region);
      expect(screen.getByTestId('date-announce')).toHaveTextContent('Yesterday, Wednesday, 7 Oct');
      expect(announce).not.toHaveBeenCalled();
      announce.mockRestore();
    });
  });

  describe('weekly check-in on a past week', () => {
    const seed = async (db: Db) => {
      for (let i = 0; i < 28; i++) {
        await saveLog(db, meal(addDays(TODAY, -i), 1, 1500));
        await saveDayNote(db, { id: null, version: 0, updated_at: '', deleted_at: null, date: addDays(TODAY, -i), complete: true, steps: 8000, sleep: 6.5, fast: false });
      }
      for (let i = 0; i < 24; i++) await saveWeight(db, { id: null, version: 0, updated_at: '', deleted_at: null, date: addDays(TODAY, -i), weight_kg: Math.round((80 + i * 0.1) * 10) / 10 });
    };
    const settingsDoc = (db: Db) => JSON.parse(db.rows.get('user_settings:me') as string);

    it('answering the card keys it by the viewed week but prunes by the real today, and "seen" is the real week', async () => {
      const db = memoryDb();
      // 7 Jul is before 90 days back from today (10 Jul) but not from the viewed day (1 Oct: 3 Jul).
      await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), adjustments: { dismissed: { 'ci:2026-07-06': true, 'ci:2026-07-13': true } } });
      await seed(db);
      await setup(db);
      for (let i = 0; i < 7; i++) await back();
      await screen.findByText('Thursday, 1 Oct');
      await fireEvent.press(await screen.findByLabelText('Update my targets'));
      await waitFor(() => expect(settingsDoc(db).adjustments.dismissed).toEqual({ 'ci:2026-07-13': true, 'ci:2026-09-28': true }));
      expect(settingsDoc(db).checkin_seen).toBe('2026-10-05');
    });
  });
});
