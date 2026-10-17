import { AccessibilityInfo, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { ViewedDateProvider, useViewedDate } from '../src/state/ViewedDate';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0); // Thursday
const MONDAY = () => new Date(2026, 9, 19, 10, 0, 0);
const TODAY = '2026-10-08';
const YESTERDAY = '2026-10-07';

const profile = () =>
  buildProfile(
    { ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] },
    new Date(2026, 8, 1),
  );

type Db = ReturnType<typeof memoryDb>;
async function setup(now: () => Date = NOW, seed?: (db: Db) => void | Promise<void>) {
  const db = memoryDb();
  await saveProfile(db, profile());
  await seed?.(db);
  await render(withProfile(db, <FoodScreen db={db} now={now} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
const back = async () => fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
const forward = async () => fireEvent.press(screen.getByRole('button', { name: 'Next day' }));
const log = (id: string, date: string, over: Record<string, unknown> = {}) => ({ id, version: 0, updated_at: '2026-10-08T00:00:00Z', deleted_at: null, date, meal: 'Lunch', name: 'Roti / chapati', qty: 1, kcal: 102, protein_g: 4, carbs_g: 0, fat_g: 0, food_id: null, ...over });
const addRoti = async () => {
  await fireEvent.press(screen.getByLabelText('+ Add to breakfast'));
  await screen.findByLabelText('Search foods');
  await fireEvent.press(screen.getByLabelText(/^Add Roti \/ chapati/));
  await screen.findByText(/Added Roti/);
  await fireEvent.press(screen.getByText('Done'));
};

describe('Food date navigation', () => {
  it('labels the day Today, Yesterday, then the weekday, and turns next off at today', async () => {
    await setup();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Thursday, 8 Oct')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' }).props.accessibilityState).toMatchObject({ disabled: true });
    await back();
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Wednesday, 7 Oct')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next day' }).props.accessibilityState).toMatchObject({ disabled: false });
    await back();
    expect(screen.getByText('Tue')).toBeTruthy();
    await forward();
    await forward();
    expect(screen.getByText('Today')).toBeTruthy();
    await forward();
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('announces the new day when it changes, but not on the first show', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    announce.mockClear(); // React Native's jest setup shares one mock across tests
    await setup();
    expect(announce).not.toHaveBeenCalled();
    await back();
    expect(announce).toHaveBeenCalledWith('Yesterday, Wednesday, 7 Oct');
    announce.mockRestore();
  });

  it('shows the viewed day’s own logs', async () => {
    await setup(NOW, (db) => {
      db.rows.set('food_logs:y1', JSON.stringify(log('y1', YESTERDAY, { name: 'Yesterday dal' })));
    });
    expect(screen.queryByText('Yesterday dal')).toBeNull();
    await back();
    expect(await screen.findByText('Yesterday dal')).toBeTruthy();
  });

  it('logs on a past day with that date, and the log is still there after a reload', async () => {
    const db = await setup();
    await back();
    await addRoti();
    await waitFor(() => expect(docs(db, 'food_logs')[0]).toMatchObject({ date: YESTERDAY, name: 'Roti / chapati' }));
    await screen.unmount();
    await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
    await screen.findByRole('header', { name: 'Food' });
    expect(screen.queryByText(/Roti/)).toBeNull(); // a reload shows today, which has nothing logged
    await back();
    expect(await screen.findByText(/^Roti \/ chapati/)).toBeTruthy();
  });

  it('writes the day-complete tick for the viewed day', async () => {
    const db = await setup(NOW, (d) => {
      d.rows.set('food_logs:y1', JSON.stringify(log('y1', YESTERDAY)));
    });
    await back();
    await fireEvent.press(await screen.findByLabelText('I’ve logged everything I ate today'));
    await waitFor(() => expect(docs(db, 'day_notes')[0]).toMatchObject({ date: YESTERDAY, complete: true }));
    expect(docs(db, 'day_notes').some((n) => n.date === TODAY)).toBe(false);
  });

  it('plans a bigger day on the viewed day only from today (the chips are hidden on a past day)', async () => {
    await setup();
    expect(screen.getByRole('button', { name: /What should I eat next\? Breakfast ideas/ })).toBeTruthy();
    await back();
    expect(screen.queryByRole('button', { name: /What should I eat next\?/ })).toBeNull();
    expect(screen.queryByLabelText('Plan a bigger day')).toBeNull();
  });

  it('hides the low-protein add-on on a past day', async () => {
    await setup(NOW, (db) => {
      db.rows.set('food_logs:t1', JSON.stringify(log('t1', TODAY)));
      db.rows.set('food_logs:y1', JSON.stringify(log('y1', YESTERDAY)));
    });
    expect(await screen.findByText(/^Low on protein/)).toBeTruthy();
    await back();
    await screen.findByText(/^Roti \/ chapati/);
    expect(screen.queryByText(/^Low on protein/)).toBeNull();
  });

  it('hides the weekly check-in banner on a past day', async () => {
    await setup(MONDAY);
    expect(screen.getByText('Your weekly check-in is ready.')).toBeTruthy();
    await back(); // Sunday: the banner is for today only, even though the day shown is one it would show on
    expect(screen.queryByText('Your weekly check-in is ready.')).toBeNull();
  });

  it('shows the banner again when back on today', async () => {
    await setup(MONDAY);
    await back();
    await forward();
    expect(screen.getByText('Your weekly check-in is ready.')).toBeTruthy();
  });
});

describe('useViewedDate', () => {
  function Probe({ id, now }: { id: string; now: () => Date }) {
    const v = useViewedDate(now);
    return (
      <>
        <Text testID={`${id}-date`}>{v.date}</Text>
        <Text testID={`${id}-prev`} onPress={v.prev}>prev</Text>
        <Text testID={`${id}-next`} onPress={v.next}>next</Text>
      </>
    );
  }
  it('is shared by every screen under the provider', async () => {
    await render(
      <ViewedDateProvider>
        <Probe id="a" now={NOW} />
        <Probe id="b" now={NOW} />
      </ViewedDateProvider>,
    );
    await fireEvent.press(screen.getByTestId('a-prev'));
    expect(screen.getByTestId('b-date').props.children).toBe(YESTERDAY);
  });
  it('never goes past today', async () => {
    await render(<Probe id="a" now={NOW} />);
    await fireEvent.press(screen.getByTestId('a-next'));
    expect(screen.getByTestId('a-date').props.children).toBe(TODAY);
  });
  it('follows midnight while on today, and stays put on a past day', async () => {
    let clock = NOW;
    const ui = () => (
      <ViewedDateProvider>
        <Probe id="a" now={clock} />
      </ViewedDateProvider>
    );
    await render(ui());
    clock = () => new Date(2026, 9, 9, 0, 5, 0);
    await screen.rerender(ui());
    expect(screen.getByTestId('a-date').props.children).toBe('2026-10-09');
    await fireEvent.press(screen.getByTestId('a-prev'));
    clock = () => new Date(2026, 9, 10, 0, 5, 0);
    await act(async () => screen.rerender(ui()));
    expect(screen.getByTestId('a-date').props.children).toBe('2026-10-08');
  });
});
