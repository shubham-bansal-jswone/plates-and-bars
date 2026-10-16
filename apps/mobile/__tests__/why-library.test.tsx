import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import cards from '../../../content/cards.json';
import { fibreTarget } from '@plate-and-bar/core';
import { saveProfile } from '../src/db/records';
import { loadSettings, saveSettings } from '../src/db/settings';
import { TargetsScreen } from '../src/screens/TargetsScreen';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { dailyRead, learnList, readLearn, withRead } from '../src/why/learn';
import { HIDDEN_CARDS } from '../src/why/cards';
import * as SettingsProvider from '../src/state/SettingsProvider';
import { WhyLink } from '../src/why/WhyLink';
import { memoryDb, withProfile } from './helpers';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []),
}));

const shown = cards.cards.filter((c) => !HIDDEN_CARDS.includes(c.id));
const profile = (sex: 'male' | 'female' = 'male') =>
  buildProfile({ ...emptyDraft(), sex, age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 9, 8));

describe('learn order and due card (pure)', () => {
  it('orders by learn_order, leaves held-back cards out, and sets the female card in at its index', () => {
    const ids = (sex?: string) => learnList(sex).map((c) => c.id);
    expect(ids('male')).toEqual(['rir', 'protein', 'scale', 'overload', 'spot', 'sleep', 'volume', 'deload', 'soreness', 'creatine']);
    // learn_insert_at 6 counts the full order (formfirst, ramp, rir, protein, scale, overload), so it lands before 'spot'.
    expect(ids('female').indexOf('bulky')).toBe(ids('female').indexOf('spot') - 1);
    expect(ids('female')).toHaveLength(11);
  });
  it('shows one more card every 3 days, skipping read ones', () => {
    expect(dailyRead({ start: '2026-10-01', read: [] }, 'male', '2026-10-01').next?.id).toBe('rir');
    expect(dailyRead({ start: '2026-10-01', read: ['rir'] }, 'male', '2026-10-03').next).toBeNull();
    expect(dailyRead({ start: '2026-10-01', read: ['rir'] }, 'male', '2026-10-04').next?.id).toBe('protein');
    expect(dailyRead({ start: '2026-10-01', read: ['rir', 'x'] }, 'male', '2026-10-04')).toMatchObject({ readN: 1, total: 10 });
    expect(dailyRead({}, 'male', '2026-10-04').next?.id).toBe('rir'); // no start yet: it is day one
  });
  it('never counts more cards due than the list holds, however long ago it started', () => {
    const ids = learnList('male').map((c) => c.id);
    expect(dailyRead({ start: '2025-01-01', read: [] }, 'male', '2026-10-08').next?.id).toBe('rir');
    expect(dailyRead({ start: '2025-01-01', read: ids.slice(0, -1) }, 'male', '2026-10-08')).toMatchObject({ next: { id: ids[ids.length - 1] }, readN: ids.length - 1, total: ids.length });
    expect(dailyRead({ start: '2025-01-01', read: ids }, 'male', '2026-10-08').next).toBeNull();
  });
  it('withRead adds an id once, keeps other keys, and starts the clock', () => {
    expect(withRead({}, 'rir', '2026-10-01')).toEqual({ start: '2026-10-01', read: ['rir'] });
    expect(withRead({ start: '2026-09-01', read: ['rir'], extra: 1 }, 'protein', '2026-10-01')).toEqual({ start: '2026-09-01', read: ['rir', 'protein'], extra: 1 });
    expect(withRead({ start: 's', read: ['rir'] }, 'rir', 't')).toBeNull();
    expect(readLearn({ start: 3, read: 'x' })).toEqual({ start: null, read: [] });
  });
});

describe('Why it works library on Targets', () => {
  it('lists every shown card with its evidence, marks a card read when opened, saves it, and fills the fibre target', async () => {
    const db = memoryDb();
    const p = profile();
    await saveProfile(db, p);
    await render(withProfile(db, <TargetsScreen db={db} />));
    expect(await screen.findByText('Why it works')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Open /)).toHaveLength(shown.length);
    expect(screen.queryByLabelText(/^Open .*(Ramp|form first)/i)).toBeNull();
    for (const x of shown) expect(screen.getByText(`${x.title} ${x.evidence}`)).toBeTruthy(); // the evidence label is on every row
    const fibre = cards.cards.find((c) => c.id === 'fibre')!;
    expect(screen.queryByText(/ read$/)).toBeNull();
    fireEvent.press(screen.getByLabelText(`Open ${fibre.title}`));
    expect(await screen.findByText(new RegExp(`${fibreTarget(p.targets.kcal)} g`))).toBeTruthy();
    await waitFor(async () => expect(readLearn((await loadSettings(db))!.learn).read).toEqual(['fibre']));
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.getByText(' read')).toBeTruthy();
  });
});

describe('Daily read card on Progress', () => {
  it('shows the next card with progress, opens it and moves on after it is read', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveSettings(db, { ...defaultSettings('2026-10-01T00:00:00Z'), learn: { start: '2026-10-01', read: [] } });
    await render(withProfile(db, <ProgressScreen db={db} now={() => new Date(2026, 9, 1, 9)} />));
    const rir = cards.cards.find((c) => c.id === 'rir')!;
    expect(await screen.findByText('2-minute read, 0 of 10 done')).toBeTruthy();
    expect(screen.getByText(rir.title)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText(`Read ${rir.title}`)); });
    await waitFor(async () => expect(readLearn((await loadSettings(db))!.learn).read).toEqual(['rir']));
    // Day one has only one card due, so the card is gone once read, but the open sheet stays until it is closed.
    expect(screen.queryByText('2-minute read, 1 of 10 done')).toBeNull();
    expect(screen.getByLabelText('Close')).toBeTruthy();
    expect(screen.getByText(rir.summary)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByLabelText('Close')).toBeNull();
  });
  it('starts the clock the first time it shows', async () => {
    const db = memoryDb();
    await saveProfile(db, profile());
    await saveSettings(db, defaultSettings('2026-10-01T00:00:00Z'));
    await render(withProfile(db, <ProgressScreen db={db} now={() => new Date(2026, 9, 1, 9)} />));
    await screen.findByText('2-minute read, 0 of 10 done');
    await waitFor(async () => expect(readLearn((await loadSettings(db))!.learn).start).toBe('2026-10-01'));
  });
});

describe('Why sheet read tracking', () => {
  afterEach(() => jest.restoreAllMocks());
  const stub = (learn: Record<string, unknown>) => {
    const update = jest.fn(() => true);
    jest.spyOn(SettingsProvider, 'useOptionalSettings').mockReturnValue({ ready: true, settings: { learn }, update } as unknown as ReturnType<typeof SettingsProvider.useOptionalSettings>);
    return update;
  };
  const open = async (now?: () => Date) => {
    await render(<WhyLink id="protein" now={now} />);
    await fireEvent.press(await screen.findByLabelText(/^Why\? /));
  };
  type Patch = (s: { learn: Record<string, unknown> }) => { learn?: Record<string, unknown> };

  it('writes with a function update, so a sync reload that landed meanwhile is kept', async () => {
    const update = stub({ start: '2026-10-01', read: [] });
    await open(() => new Date(2026, 9, 8, 10));
    expect(update).toHaveBeenCalledTimes(1);
    const patch = (update.mock.calls[0] as unknown as [Patch])[0];
    expect(typeof patch).toBe('function');
    // The settings the write runs against are newer than what the sheet rendered with.
    expect(patch({ learn: { start: '2026-09-20', read: ['rir'], extra: 1 } }).learn).toEqual({ start: '2026-09-20', read: ['rir', 'protein'], extra: 1 });
    // The pulled record already has it read: nothing to change.
    expect(patch({ learn: { start: '2026-09-20', read: ['protein'] } })).toEqual({});
  });
  it('starts the clock from the injected now', async () => {
    const update = stub({});
    await open(() => new Date(2026, 9, 8, 10));
    const patch = (update.mock.calls[0] as unknown as [Patch])[0];
    expect(patch({ learn: {} }).learn).toEqual({ start: '2026-10-08', read: ['protein'] });
  });
  it('writes nothing when the card is already read', async () => {
    const update = stub({ start: '2026-10-01', read: ['protein'] });
    await open();
    expect(update).not.toHaveBeenCalled();
  });
});
