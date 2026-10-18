import { AccessibilityInfo, Platform, Text } from 'react-native';
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
  await fireEvent.press(screen.getByLabelText(/^Roti \/ chapati/));
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

  describe('announcing the day', () => {
    const os = Platform.OS;
    afterEach(() => {
      Platform.OS = os;
    });
    // Holds the viewed day's read, so the screen shows Loading (and swaps its tree) while the day changes.
    const slowDay = (db: Db) => {
      const read = db.getAllAsync.bind(db);
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
        if (sql.includes('FROM food_logs WHERE log_date')) await gate;
        return read(sql, ...p);
      }) as typeof db.getAllAsync;
      return open;
    };

    it('on iOS, announces once per change and not on the first show; the live region stays empty', async () => {
      Platform.OS = 'ios';
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear(); // React Native's jest setup shares one mock across tests
      const db = await setup();
      expect(announce).not.toHaveBeenCalled();
      const open = slowDay(db);
      await back();
      await act(async () => open());
      await screen.findByText('Wednesday, 7 Oct');
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Yesterday, Wednesday, 7 Oct');
      expect(screen.getByTestId('date-announce')).toHaveTextContent('');
      announce.mockRestore();
    });

    it.each(['android', 'web'] as const)('on %s, one polite live region says it once, with no explicit announcement and none on the bar label', async (os) => {
      Platform.OS = os;
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      announce.mockClear();
      const db = await setup();
      expect(screen.getByTestId('date-announce')).toHaveTextContent('');
      const region = screen.getByTestId('date-announce');
      const open = slowDay(db);
      await back();
      expect(screen.getByText('Loading…')).toBeTruthy(); // the screen's tree is swapped here
      await act(async () => open());
      await screen.findByText('Wednesday, 7 Oct');
      expect(screen.getByTestId('date-announce')).toBe(region); // same instance: not remounted, so the change is spoken
      expect(screen.getByTestId('date-announce')).toHaveTextContent('Yesterday, Wednesday, 7 Oct');
      expect(screen.getByTestId('date-announce').props.accessibilityLiveRegion).toBe('polite');
      expect(screen.getByLabelText('Yesterday, Wednesday, 7 Oct').props.accessibilityLiveRegion).toBeUndefined(); // the bar's own label is not a second one
      expect(announce).not.toHaveBeenCalled();
      announce.mockRestore();
    });
  });

  it('shows the viewed day’s own logs', async () => {
    await setup(NOW, (db) => {
      db.rows.set('food_logs:y1', JSON.stringify(log('y1', YESTERDAY, { name: 'Yesterday dal' })));
    });
    expect(screen.queryByText('Yesterday dal')).toBeNull();
    await back();
    expect(await screen.findByText('Yesterday dal')).toBeTruthy();
  });

  it('shows Loading, not the old day’s rows, while the other day is read (nothing can be written against stale rows)', async () => {
    const db = await setup(NOW, (d) => {
      d.rows.set('food_logs:t1', JSON.stringify(log('t1', TODAY, { name: 'Today dal' })));
    });
    expect(await screen.findByText('Today dal')).toBeTruthy();
    const read = db.getAllAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM food_logs WHERE log_date')) await gate;
      return read(sql, ...p);
    }) as typeof db.getAllAsync;
    await back();
    expect(screen.queryByText('Today dal')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy(); // the bar stays, so the day can still be changed
    await act(async () => open());
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
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

  it('does not let Undo last water delete today’s drink while the other day’s water is still being read', async () => {
    const db = await setup(NOW, (d) => {
      d.rows.set('water_logs:w1', JSON.stringify({ id: 'w1', version: 0, updated_at: '2026-10-08T05:00:00.000Z', deleted_at: null, date: TODAY, ml: 250 }));
    });
    await screen.findByLabelText('Undo last water');
    const read = db.getAllAsync.bind(db);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM water_logs')) await gate;
      return read(sql, ...p);
    }) as typeof db.getAllAsync;
    await back();
    await screen.findByText('Wednesday, 7 Oct');
    expect(screen.queryByLabelText('Undo last water')).toBeNull(); // the card waits for the viewed day
    await act(async () => open());
    await waitFor(() => expect(screen.getByLabelText('0 of about 3.3 litres')).toBeTruthy());
    expect(docs(db, 'water_logs')[0]).toMatchObject({ id: 'w1', deleted_at: null });
  });

  it('shows the banner again when back on today', async () => {
    await setup(MONDAY);
    await back();
    await forward();
    expect(screen.getByText('Your weekly check-in is ready.')).toBeTruthy();
  });

  it('the energy card Save writes steps and sleep to the viewed day, not today (#822)', async () => {
    const db = await setup();
    await back();
    await fireEvent.press(await screen.findByLabelText('Show burn details'));
    await fireEvent.changeText((await screen.findAllByLabelText('Steps today'))[0]!, '6100');
    await fireEvent.changeText(screen.getAllByLabelText('Hours slept last night')[0]!, '6.5');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep from the burn details'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ date: YESTERDAY, steps: 6100, sleep: 6.5 })]));
    // Back on today, nothing was stored for it, so its box is empty.
    await forward();
    expect(docs(db, 'day_notes').some((n) => n.date === TODAY)).toBe(false);
    await fireEvent.press(await screen.findByLabelText('Show burn details'));
    expect((await screen.findAllByLabelText('Steps today'))[0]!.props.value).toBe('');
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
  it('going back to today clears the pick, so the screen follows midnight again (prev, next, cross midnight)', async () => {
    let clock = NOW;
    const ui = () => (
      <ViewedDateProvider>
        <Probe id="a" now={clock} />
      </ViewedDateProvider>
    );
    await render(ui());
    await fireEvent.press(screen.getByTestId('a-prev'));
    await fireEvent.press(screen.getByTestId('a-next'));
    expect(screen.getByTestId('a-date').props.children).toBe(TODAY);
    clock = () => new Date(2026, 9, 9, 0, 5, 0);
    await act(async () => screen.rerender(ui()));
    expect(screen.getByTestId('a-date').props.children).toBe('2026-10-09'); // a stuck pick of today would stay on the 8th
  });
});
