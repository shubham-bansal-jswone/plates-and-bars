import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FoodScreen } from '../src/screens/FoodScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { saveDayNote } from '../src/db/food';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { whyCard } from '../src/why/cards';
import { memoryDb, withProfile } from './helpers';

const mockPush = jest.fn();
const mockFocus = { n: 0 };
const mockAi = { describe: false };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [mockFocus.n]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
jest.mock('../src/ai/AiProvider', () => ({ useAi: () => ({ available: (f: string) => f === 'describe_meal' && mockAi.describe }) }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));

type Db = ReturnType<typeof memoryDb>;
const docs = (db: Db, table: string) => [...db.rows].filter(([k]) => k.startsWith(`${table}:`)).map(([, v]) => JSON.parse(v));
async function food(opts: { withProfile?: boolean; db?: Db } = {}) {
  const db = opts.db ?? memoryDb();
  if (opts.withProfile !== false) await saveProfile(db, profile());
  await render(withProfile(db, <FoodScreen db={db} now={NOW} />));
  await screen.findByRole('header', { name: 'Food' });
  return db;
}
const details = async () => {
  await fireEvent.press(await screen.findByLabelText('Show burn details'));
  await screen.findAllByLabelText('Steps today');
};

beforeEach(() => {
  mockAi.describe = false;
  mockPush.mockClear();
  mockFocus.n = 0;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('Food without a profile (#822)', () => {
  it('shows the Start setup banner, which opens setup, and no burn card', async () => {
    await food({ withProfile: false });
    expect(screen.getByText('Get calorie and macro targets worked out for you.')).toBeTruthy();
    expect(screen.queryByLabelText('Show burn details')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Start setup'));
    expect(mockPush).toHaveBeenCalledWith('/setup');
  });

  it('shows no banner once there is a profile', async () => {
    await food();
    await screen.findByLabelText('Show burn details');
    expect(screen.queryByText('Get calorie and macro targets worked out for you.')).toBeNull();
  });
});

describe('Steps and sleep in the burn details (#822)', () => {
  it('shows both inputs with the prototype hints and the two why-links, only under Details', async () => {
    await food();
    expect(screen.queryByLabelText('Steps today')).toBeNull();
    await details();
    expect(screen.getByLabelText('Hours slept last night')).toBeTruthy();
    expect(screen.getByText('steps today, target about 7,000')).toBeTruthy();
    expect(screen.getByText('hours slept last night (aim for 7–9)')).toBeTruthy();
    expect(screen.getByLabelText(`Why? ${whyCard('activity')!.title}`)).toBeTruthy();
    expect(screen.getByLabelText(`Why? ${whyCard('sleep')!.title}`)).toBeTruthy();
  });

  it('writes steps and sleep to the day note (so they sync) and the burn uses the steps', async () => {
    const db = await food();
    await details();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '8200');
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '7.5');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep from the burn details'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ date: DATE, steps: 8200, steps_source: 'manual', sleep: 7.5 })]));
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByLabelText(/^Daily movement, from 8,200 steps/)).toBeTruthy();
  });

  it('saving only the sleep from the burn details keeps a phone step count and its source (#300)', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: null, steps: 6400, steps_source: 'device', sleep: null, fast: false });
    await food({ db });
    await details();
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '7');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep from the burn details'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: 6400, steps_source: 'device', sleep: 7 })]));
  });

  it('a sleep-only save leaves steps out of the write: a count the phone stored after the screen loaded is not overwritten (#300)', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: null, steps: 6400, steps_source: 'device', sleep: null, fast: false });
    await food({ db });
    await details();
    // a later reading lands in the store while the box still shows 6400
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T05:00:00Z', date: DATE, complete: null, steps: 9100, steps_source: 'device', sleep: null, fast: false });
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '7');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep from the burn details'));
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: 9100, steps_source: 'device', sleep: 7 })]));
  });

  it('keeps the validation: sleep over 24 h and bad steps are refused, 0 is kept, a blank box clears', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveDayNote(db, { id: null, version: 1, deleted_at: null, updated_at: '2026-10-08T01:00:00Z', date: DATE, complete: true, steps: 5000, sleep: 6, fast: false });
    await food({ db });
    await details();
    const save = () => fireEvent.press(screen.getByLabelText('Save steps and sleep from the burn details'));
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '25');
    await save();
    expect(await screen.findByText('Enter hours slept, like 7.5.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Steps today'), 'abc');
    await save();
    expect(await screen.findByText('Enter steps as a whole number, like 8000.')).toBeTruthy();
    expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: 5000, sleep: 6 })]);
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '0');
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '0');
    await save();
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: 0, steps_source: 'manual', sleep: 0, complete: true })]));
    await fireEvent.changeText(screen.getByLabelText('Steps today'), '');
    await fireEvent.changeText(screen.getByLabelText('Hours slept last night'), '');
    await save();
    await waitFor(() => expect(docs(db, 'day_notes')).toEqual([expect.objectContaining({ steps: null, steps_source: null, sleep: null })]));
  });

  it('a value typed on Food shows on Progress, and one typed on Progress shows on Food', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    const ui = () => withProfile(db, <><FoodScreen db={db} now={NOW} /><ProgressScreen db={db} now={NOW} /></>);
    const view = await render(ui());
    await screen.findByRole('header', { name: 'Progress' });
    await details();
    // Food's burn details come first in the tree, Progress's own boxes second.
    await fireEvent.changeText(screen.getAllByLabelText('Steps today')[0]!, '9100');
    await fireEvent.changeText(screen.getAllByLabelText('Hours slept last night')[0]!, '8');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep from the burn details'));
    await waitFor(() => expect(docs(db, 'day_notes')).toHaveLength(1));
    mockFocus.n = 1;
    await view.rerender(ui());
    await waitFor(() => expect(screen.getAllByLabelText('Steps today')[1]!.props.value).toBe('9100'));
    expect(screen.getAllByLabelText('Hours slept last night')[1]!.props.value).toBe('8');
    // And back: Progress saves, Food shows it when its tab is shown again.
    await fireEvent.changeText(screen.getAllByLabelText('Steps today')[1]!, '4300');
    await fireEvent.press(screen.getByLabelText('Save steps and sleep'));
    await waitFor(() => expect(docs(db, 'day_notes')[0]).toMatchObject({ steps: 4300 }));
    mockFocus.n = 2;
    await view.rerender(ui());
    await waitFor(() => expect(screen.getAllByLabelText('Steps today')[0]!.props.value).toBe('4300'));
  });
});

describe('Add food hints (#822)', () => {
  const open = async () => {
    await fireEvent.press(screen.getByLabelText('+ Add to breakfast'));
    await screen.findByLabelText('Search foods');
  };

  it('the eat-out footer ends with the bigger-day pointer', async () => {
    await food();
    await open();
    await fireEvent.press(screen.getByLabelText('Eating out'));
    expect(screen.getByText('Rough restaurant estimates; portions and oil vary a lot. A big night out? Use “Plan a bigger day” in meal ideas to balance it over the next few days.')).toBeTruthy();
  });

  it('no match mentions Describe only when the describe-meal feature is available', async () => {
    await food();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'zzzz');
    expect(screen.getByText('No match. Use Custom to enter it yourself.')).toBeTruthy();
    await act(async () => undefined);
  });

  it('with the feature on, no match adds ", or Describe to have AI estimate it"', async () => {
    mockAi.describe = true;
    await food();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'zzzz');
    expect(screen.getByText('No match. Use Custom to enter it yourself, or Describe to have AI estimate it.')).toBeTruthy();
  });
});
