import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout } from '../src/workout/types';
import { focusNode } from '../src/labelscan/focus';
import { press } from './disclosure-helpers';
import { memoryDb, withProfile } from './helpers';

// Reorder, remove one member and merge two supersets on the active workout screen (#1345; rules and vectors in core: golden/group-edits.json).
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('../src/labelscan/focus', () => ({ ...jest.requireActual('../src/labelscan/focus'), focusNode: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THU = () => new Date(2026, 9, 8, 10, 0, 0); // Push B
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const { Platform } = jest.requireActual('react-native');
beforeEach(() => {
  Platform.OS = 'android';
  (focusNode as jest.Mock).mockClear();
});
const stored = (db: ReturnType<typeof memoryDb>) => JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout;
const order = (db: ReturnType<typeof memoryDb>) => stored(db).exercises.map((e) => e.name);
const groupsOf = (db: ReturnType<typeof memoryDb>) => stored(db).exercises.map((e) => e.group ?? null);
const live = () => screen.getByTestId('session-announce').props.children as string;
/** The accessibility label of the node the last focus call went to. */
const focusedLabel = () => (focusNode as jest.Mock).mock.calls.at(-1)?.[0]?.props?.accessibilityLabel;
const focusedText = () => (focusNode as jest.Mock).mock.calls.at(-1)?.[0]?.props?.children;

/** Starts Push B, then reopens the screen on the same session with skip_ramp on and `groups[i]` as exercise i's group (`secondFrom`: exercises from there on are the second session). */
async function mount(groups: (string | null)[] = [], o: { secondFrom?: number } = {}) {
  const db = memoryDb();
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
  await saveProfile(db, { ...profile, where: 'gym' });
  const first = await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  await press('Start Push B');
  await waitFor(() => expect(db.rows.get(`workouts:${DATE}`)).toBeTruthy());
  await first.unmount();
  const w = stored(db);
  db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, exercises: w.exercises.map((e, i) => ({ ...e, skip_ramp: true, ...(o.secondFrom !== undefined && i >= o.secondFrom ? { part: 2 as const } : {}), ...(groups[i] ? { group: groups[i] } : {}) })), updated_at: '2026-10-08T09:30:00Z' }));
  await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  const names = order(db);
  await screen.findAllByLabelText(`Add set to ${names[0]}`);
  return { db, names };
}
/** Opens a collapsed exercise (a member shows its letter in the name). */
const open = (name: string) => press(new RegExp(`^${name}, \\d+/\\d+ sets(, [A-Z])?(, up next)?\\. Show sets`));

describe('Move up and Move down', () => {
  it('moves an ungrouped exercise, stores the new order, says where it is and keeps focus on the chip', async () => {
    const { db, names } = await mount();
    await press(`Move ${names[0]} down`);
    await waitFor(() => expect(order(db).slice(0, 3)).toEqual([names[1], names[0], names[2]]));
    expect(live()).toBe(`${names[0]} moved down, now 2 of ${names.length}.`);
    expect(focusedLabel()).toBe(`Move ${names[0]} down`);
    expect(screen.getByLabelText(`Move ${names[0]} up`)).toBeTruthy();
    await press(`Move ${names[0]} down`);
    await waitFor(() => expect(order(db).slice(0, 3)).toEqual([names[1], names[2], names[0]]));
    await press(`Move ${names[0]} up`);
    await waitFor(() => expect(order(db).slice(0, 3)).toEqual([names[1], names[0], names[2]]));
    expect(live()).toBe(`${names[0]} moved up, now 2 of ${names.length}.`);
    expect(focusedLabel()).toBe(`Move ${names[0]} up`);
  });

  it('has no chip where there is no step: the first exercise has no Move up, and focus goes to Move down when it was the last step up', async () => {
    const { names } = await mount();
    expect(screen.queryByLabelText(`Move ${names[0]} up`)).toBeNull();
    expect(screen.getByLabelText(`Move ${names[0]} down`)).toBeTruthy();
    await press(`Move ${names[0]} down`);
    await press(`Move ${names[0]} up`); // back at the top: its Move up is gone
    expect(screen.queryByLabelText(`Move ${names[0]} up`)).toBeNull();
    expect(focusedLabel()).toBe(`Move ${names[0]} down`);
  });

  it('is refused across the session parts: no chip', async () => {
    const { names } = await mount([], { secondFrom: 1 });
    expect(screen.queryByLabelText(`Move ${names[0]} down`)).toBeNull();
  });

  it('an ungrouped exercise hops the whole superset', async () => {
    const { db, names } = await mount([null, 'g', 'g', 'g']);
    await press(`Move ${names[0]} down`);
    await waitFor(() => expect(order(db)).toEqual([names[1], names[2], names[3], names[0], names[4]]));
    expect(groupsOf(db)).toEqual(['g', 'g', 'g', null, null]);
    expect(live()).toBe(`${names[0]} moved down, now 4 of 5.`);
  });

  it('a member swaps with its neighbour in the superset and is announced with its new letter', async () => {
    const { db, names } = await mount(['g', 'g', 'g']);
    await press(`Move ${names[0]} down`);
    await waitFor(() => expect(order(db).slice(0, 3)).toEqual([names[1], names[0], names[2]]));
    expect(groupsOf(db).slice(0, 3)).toEqual(['g', 'g', 'g']);
    expect(live()).toBe(`${names[0]} moved down, now B of 3 in the superset.`);
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[0]} set 1, B1 done`))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[1]} set 1, A1 done`))).toBeTruthy();
  });

  it('swapping members keeps the block and its cards mounted: an armed Remove stays armed', async () => {
    const { names } = await mount(['g', 'g', 'g']);
    await press(`Remove exercise ${names[2]} from today`);
    expect(screen.getByText('Tap again to remove')).toBeTruthy();
    await press(`Move ${names[0]} down`);
    expect(screen.getByText('Tap again to remove')).toBeTruthy();
  });

  it('the last member moving down leaves the superset: explicit null, the hint says so, the rest stays a superset', async () => {
    const { db, names } = await mount(['g', 'g', 'g']);
    expect(screen.getByLabelText(`Move ${names[2]} down`).props.accessibilityHint).toBe('Takes it out of the superset.');
    expect(screen.getByLabelText(`Move ${names[0]} down`).props.accessibilityHint).toBeUndefined();
    await press(`Move ${names[2]} down`);
    await waitFor(() => expect(order(db).slice(0, 4)).toEqual([names[0], names[1], names[3], names[2]]));
    expect(groupsOf(db).slice(0, 4)).toEqual(['g', 'g', null, null]);
    expect(stored(db).exercises[3]).toHaveProperty('group', null);
    expect(live()).toBe(`${names[2]} moved down out of the superset, now 4 of ${names.length}.`);
  });

  it('a member of a pair leaving by a move dissolves the pair: both get an explicit null and the one left is named', async () => {
    const { db, names } = await mount([null, 'g', 'g']);
    await open(names[1]!);
    await press(`Move ${names[1]} up`);
    await waitFor(() => expect(order(db).slice(0, 3)).toEqual([names[1], names[0], names[2]]));
    expect(groupsOf(db).slice(0, 3)).toEqual([null, null, null]);
    expect(stored(db).exercises[2]).toHaveProperty('group', null);
    expect(live()).toBe(`${names[1]} moved up out of the superset, now 1 of ${names.length}. ${names[2]} is no longer in a superset.`);
    expect(screen.queryByLabelText(/^Superset: /)).toBeNull();
  });

  it('announces on iOS, which has no live regions', async () => {
    Platform.OS = 'ios';
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    const { names } = await mount();
    await press(`Move ${names[0]} down`);
    expect(spy).toHaveBeenCalledWith(`${names[0]} moved down, now 2 of ${names.length}.`);
    spy.mockRestore();
  });

  it('controls have 44px targets', async () => {
    const { names } = await mount();
    const chip = screen.getByLabelText(`Move ${names[0]} down`);
    const style = [chip.props.style].flat(Infinity).reduce((a, s) => ({ ...a, ...(typeof s === 'function' ? s({ pressed: false }) : s) }), {} as Record<string, number>);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });
});

describe('Remove from superset', () => {
  it('from 3: the member stays in the session, the rest stays grouped and is re-lettered, and focus goes to its heading', async () => {
    const { db, names } = await mount(['g', 'g', 'g']);
    await press(`Remove ${names[0]} from superset`);
    await waitFor(() => expect(groupsOf(db).slice(0, 3)).toEqual([null, 'g', 'g']));
    expect(stored(db).exercises[0]).toHaveProperty('group', null);
    expect(order(db)).toEqual(names);
    expect(screen.getByText(`${names[0]} is out of the superset. Superset is now A and B.`)).toBeTruthy();
    expect(screen.getByLabelText(`Ungroup superset of ${names[1]} and ${names[2]}`)).toBeTruthy();
    expect(focusedText()).toBe(names[0]);
  });

  it('from 3, a middle member goes below the group', async () => {
    const { db, names } = await mount(['g', 'g', 'g']);
    await press(`Remove ${names[1]} from superset`);
    await waitFor(() => expect(order(db).slice(0, 3)).toEqual([names[0], names[2], names[1]]));
    expect(groupsOf(db).slice(0, 3)).toEqual(['g', 'g', null]);
  });

  it('from 2: the group dissolves, both get an explicit null, the toast names the one left', async () => {
    const { db, names } = await mount(['g', 'g']);
    await press(`Remove ${names[0]} from superset`);
    await waitFor(() => expect(groupsOf(db).slice(0, 2)).toEqual([null, null]));
    expect(stored(db).exercises[1]).toHaveProperty('group', null);
    expect(screen.getByText(`${names[0]} is out of the superset. ${names[1]} is no longer in a superset.`)).toBeTruthy();
    expect(screen.queryByLabelText(/^Superset: /)).toBeNull();
  });

  it('is offered on members only', async () => {
    const { names } = await mount([null, 'g', 'g']);
    expect(screen.queryByLabelText(`Remove ${names[0]} from superset`)).toBeNull();
    await open(names[1]!);
    expect(screen.getByLabelText(`Remove ${names[1]} from superset`)).toBeTruthy();
  });
});

describe('Merge two supersets', () => {
  it('the chip on the last member merges the next superset in under the first id, says so and focuses the header', async () => {
    const { db, names } = await mount(['g', 'g', 'h', 'h']);
    const chip = screen.getByLabelText(`Merge with the next superset, which starts with ${names[2]}`);
    expect(chip.props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.getByText('Merge with next superset')).toBeTruthy();
    expect(screen.queryByText(`${names[2]} is in another superset. Ungroup it first.`)).toBeNull();
    await press(`Merge with the next superset, which starts with ${names[2]}`);
    await waitFor(() => expect(groupsOf(db).slice(0, 4)).toEqual(['g', 'g', 'g', 'g']));
    expect(order(db)).toEqual(names);
    expect(live()).toBe(`Supersets merged: ${names[0]}, ${names[1]}, ${names[2]} and ${names[3]} are now one superset.`);
    expect(focusedText()).toBe('Superset');
    expect(screen.getByLabelText(new RegExp(`^Superset: ${names[0]}, ${names[1]}, ${names[2]} and ${names[3]}, round 1 of`))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[3]} set 1, D1 done`))).toBeTruthy();
  });

  it('the merge is one group: Remove from superset on the merged block still keeps the rest valid', async () => {
    const { db, names } = await mount(['g', 'g', 'h', 'h']);
    await press(`Merge with the next superset, which starts with ${names[2]}`);
    await press(`Remove ${names[0]} from superset`);
    await waitFor(() => expect(groupsOf(db).slice(0, 4)).toEqual([null, 'g', 'g', 'g']));
  });
});
