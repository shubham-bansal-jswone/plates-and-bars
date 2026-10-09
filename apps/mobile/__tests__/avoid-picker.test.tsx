import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { saveProfile } from '../src/db/records';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const NOW = () => new Date(2026, 9, 8, 10, 0, 0);
const profile = () =>
  buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 9, 1));

async function open(db = memoryDb()) {
  await saveProfile(db, profile());
  await render(withProfile(db, <TargetsScreen db={db} now={NOW} />));
  return db;
}

describe('Add an exercise to avoid (Targets)', () => {
  it('picks an exercise from the library, asks why and for how long, and stores the rule', async () => {
    const db = await open();
    await fireEvent.press(await screen.findByLabelText('Add an exercise to avoid'));
    expect(screen.getByText('Exercise to avoid')).toBeTruthy();
    expect(screen.getByLabelText('Pec Deck Fly')).toBeTruthy(); // the library's chips
    await fireEvent.press(screen.getByLabelText('Barbell Bench Press'));
    expect(screen.getByText('Can’t do Barbell Bench Press?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('I don’t like it'));
    // No session is open on this screen, so "Just today" would do nothing.
    expect(screen.queryByLabelText('Just today')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Permanently'));
    await fireEvent.press(screen.getByLabelText('Continue')); // scope: just this exercise
    await fireEvent.press(await screen.findByLabelText(/^Skip it, no replacement/));
    await waitFor(() => expect([...db.rows.keys()].filter((k) => k.startsWith('exclusions:'))).toHaveLength(1));
    const rule = JSON.parse([...db.rows].find(([k]) => k.startsWith('exclusions:'))![1]);
    expect(rule).toMatchObject({ name: 'Barbell Bench Press', scope: 'exercise', key: 'Barbell Bench Press', reason: 'dislike', until: null, deleted_at: null, version: 0 });
    expect(rule.to).toEqual({ 'Barbell Bench Press': null });
    expect(await screen.findByText(/Barbell Bench Press \(don’t like it\), permanent/)).toBeTruthy();
    expect(screen.getByText('Avoiding')).toBeTruthy();
  });

  it('a timed answer stores when to check again, and a replacement is kept with the rule', async () => {
    const db = await open();
    await fireEvent.press(await screen.findByLabelText('Add an exercise to avoid'));
    await fireEvent.press(screen.getByLabelText('Barbell Bench Press'));
    await fireEvent.press(screen.getByLabelText('Pain or an injury'));
    await fireEvent.press(screen.getByLabelText('For 2 weeks, then check again'));
    await fireEvent.press(screen.getByLabelText('Continue'));
    const pick = await screen.findAllByLabelText(/Press|Fly|Push/);
    await fireEvent.press(pick[0]!);
    await waitFor(() => expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(true));
    const rule = JSON.parse([...db.rows].find(([k]) => k.startsWith('exclusions:'))![1]);
    expect(rule.until).toBe('2026-10-22');
    expect(rule.reason).toBe('pain');
    expect(typeof Object.values(rule.to)[0]).toBe('string');
  });

  it('closing the picker stores nothing', async () => {
    const db = await open();
    await fireEvent.press(await screen.findByLabelText('Add an exercise to avoid'));
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByText('Exercise to avoid')).toBeNull();
    expect([...db.rows.keys()].some((k) => k.startsWith('exclusions:'))).toBe(false);
  });

  it('when the stored rules cannot be read, adding is refused with a message instead of writing', async () => {
    const db = memoryDb();
    const real = db.getAllAsync.bind(db);
    db.getAllAsync = (async (sql: string, ...p: (string | number)[]) => {
      if (sql.includes('FROM exclusions')) throw new Error('disk');
      return real(sql, ...p);
    }) as typeof db.getAllAsync;
    await open(db);
    expect(await screen.findByText(/Couldn’t read your saved exercise rules/)).toBeTruthy();
    expect(screen.queryByLabelText('Add an exercise to avoid')).toBeNull();
  });
});
