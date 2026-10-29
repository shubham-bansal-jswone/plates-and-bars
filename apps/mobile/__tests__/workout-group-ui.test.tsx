import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
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

// Supersets on the active workout screen (#1182 S5): units, labels, the up-next marker, the chip's reasons, ungroup.
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('../src/labelscan/focus', () => ({ ...jest.requireActual('../src/labelscan/focus'), focusNode: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THU = () => new Date(2026, 9, 8, 10, 0, 0); // Push B
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
type Db = ReturnType<typeof memoryDb>;
// iOS (the jest default) has no live regions and announces instead; the other platforms read the live region, which the tests read.
const { Platform } = jest.requireActual('react-native');
beforeEach(() => {
  Platform.OS = 'android';
  (focusNode as jest.Mock).mockClear();
});
/** The text of the node the last focus call went to. */
const focusedText = () => (focusNode as jest.Mock).mock.calls.at(-1)?.[0]?.props?.children;
const stored = (db: Db) => JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout;

/** Starts Push B, then reopens the screen on the same session with `skip_ramp` on (so no ramp blocks grouping) and `groups[i]` as exercise i's group. */
async function mount(groups: (string | null)[] = [], o: { restOff?: boolean; ramp?: boolean; secondFrom?: number } = {}) {
  const db = memoryDb();
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: o.restOff ?? true });
  await saveProfile(db, { ...profile, where: 'gym' });
  const first = await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  await press('Start Push B');
  await waitFor(() => expect(db.rows.get(`workouts:${DATE}`)).toBeTruthy());
  await first.unmount();
  const w = stored(db);
  db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, exercises: w.exercises.map((e, i) => ({ ...e, skip_ramp: !o.ramp, ...(o.secondFrom !== undefined && i >= o.secondFrom ? { part: 2 as const } : {}), ...(groups[i] ? { group: groups[i] } : {}) })), updated_at: '2026-10-08T09:30:00Z' }));
  await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  const names = stored(db).exercises.map((e) => e.name);
  await screen.findByLabelText(`Add set to ${names[0]}`);
  return { db, names };
}
/** The block: a non-accessible container with role group (accessible would make a screen reader read it as one element). */
const block = (name: RegExp) => {
  const b = screen.getByLabelText(name);
  expect(b.props.role).toBe('group');
  return b;
};
const live = () => screen.getByTestId('session-announce').props.children as string;
/** Types a weight and reps into set `j` (0-based) of `name` (its label is `{name} set {j+1}, {tag}`) and ticks it. */
async function tick(name: string, j: number, tag: string) {
  const [w, r] = screen.getAllByLabelText(new RegExp(`^${name} set ${j + 1}, ${tag} `));
  await fireEvent.changeText(w!, '40');
  await fireEvent.changeText(r!, '10');
  await press(new RegExp(`^Mark ${name} set ${j + 1}, ${tag} done`));
}
/** The member whose heading has the "Up next" caption under it. */
const upNextOf = (names: string[]) => names.filter((n) => within(screen.getByRole('header', { name: n }).parent!).queryByText('Up next'));

describe('the "Superset with next" chip', () => {
  it('is on the open exercise only, names both exercises, and makes a block with letters, A1/B1 labels and the header', async () => {
    const { names } = await mount();
    expect(screen.getAllByText('Superset with next')).toHaveLength(1);
    await press(`Superset ${names[0]} with ${names[1]}`);
    expect(block(new RegExp(`^Superset: ${names[0]} and ${names[1]}, round 1 of 3`))).toBeTruthy();
    expect(screen.getByLabelText(`Ungroup superset of ${names[0]} and ${names[1]}`)).toBeTruthy();
    expect(screen.getByText('Round 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[0]} set 1, A1 done`))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[1]} set 1, B1 done`))).toBeTruthy();
    expect(live()).toBe(`${names[0]} and ${names[1]} are now a superset.`);
    expect(focusedText()).toBe('Superset'); // focus lands on the new block's header
  });

  it('is hidden on a member that is not the last, and on the last exercise', async () => {
    const { names } = await mount(['g', 'g']);
    expect(screen.queryByLabelText(`Superset ${names[0]} with ${names[1]}`)).toBeNull();
    expect(screen.getByLabelText(`Superset ${names[1]} with ${names[2]}`)).toBeTruthy();
  });

  it('is disabled with the reason as visible text and as the accessibility hint: another superset, a finished exercise, the first-time ramp', async () => {
    const other = await mount(['g', 'g', 'h', 'h']);
    const chip = screen.getByLabelText(`Superset ${other.names[1]} with ${other.names[2]}`);
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
    expect(chip.props.accessibilityHint).toBe(`${other.names[2]} is in another superset. Ungroup it first.`);
    expect(screen.getByText(`${other.names[2]} is in another superset. Ungroup it first.`)).toBeTruthy();
    await screen.unmount();

    const ramp = await mount([], { ramp: true });
    const rc = screen.getByLabelText(`Superset ${ramp.names[0]} with ${ramp.names[1]}`);
    expect(rc.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(`Finish the first-time ramp for ${ramp.names[0]} first.`)).toBeTruthy();
  });

  it('is hidden when the next exercise is in the second session', async () => {
    const { names } = await mount([], { secondFrom: 1 });
    expect(screen.queryByLabelText(`Superset ${names[0]} with ${names[1]}`)).toBeNull();
  });

  it('a finished next exercise cannot join', async () => {
    const db = memoryDb();
    await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: true });
    await saveProfile(db, { ...profile, where: 'gym' });
    const first = await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
    await press('Start Push B');
    await waitFor(() => expect(db.sets.size).toBeGreaterThan(5));
    await first.unmount();
    const w = stored(db);
    db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, exercises: w.exercises.map((e) => ({ ...e, skip_ramp: true })), updated_at: '2026-10-08T09:30:00Z' }));
    const second = w.exercises[1]!.name;
    for (const [k, v] of db.sets) {
      const d = JSON.parse(v.data) as { exercise: string };
      if (d.exercise === second && v.kind === 'work') db.sets.set(k, { ...v, done: 1, data: JSON.stringify({ ...d, done: true, weight_kg: 40, reps: 10 }) });
    }
    await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
    const chip = await screen.findByLabelText(`Superset ${w.exercises[0]!.name} with ${second}`);
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(`${second} is already done, so it can’t join a superset.`)).toBeTruthy();
  });
});

describe('an open superset', () => {
  it('shows every member with its sets; only the up-next member has the extras, the others have "More for {name}"; other units collapse', async () => {
    const { names } = await mount(['g', 'g']);
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[0]} set 3, A3 done`))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[1]} set 3, B3 done`))).toBeTruthy();
    expect(screen.getAllByText('Up next')).toHaveLength(1);
    expect(screen.getByLabelText(`Guide and tools for ${names[0]}`)).toBeTruthy(); // up next: A
    expect(screen.queryByLabelText(`Guide and tools for ${names[1]}`)).toBeNull();
    expect(screen.queryByLabelText(`Remove exercise ${names[1]} from today`)).toBeNull();
    // Learn mode is an extra: the up-next member shows it, the other has it behind "More for".
    expect(screen.queryAllByText('Learn mode')).toHaveLength(4); // A, and the three collapsed rows (they show it as before)
    await press(`More for ${names[1]}`);
    expect(screen.getAllByText('Learn mode').length).toBe(5);
    expect(screen.getByLabelText(`Guide and tools for ${names[1]}`)).toBeTruthy();
    expect(screen.getByLabelText(`Remove exercise ${names[1]} from today`)).toBeTruthy();
    // The next unit is one collapsed row.
    expect(screen.getByLabelText(`${names[2]}, 0/3 sets. Show sets`)).toBeTruthy();
  });

  it('collapsed, a member is a row with its letter, and tapping it opens the whole block', async () => {
    const { names } = await mount([null, null, 'g', 'g']);
    expect(screen.getByLabelText(`${names[2]}, 0/3 sets, A. Show sets`)).toBeTruthy();
    expect(screen.getByLabelText(`${names[3]}, 0/3 sets, B. Show sets`)).toBeTruthy();
    expect(screen.getByText('0 of 3 rounds done')).toBeTruthy();
    await press(`${names[3]}, 0/3 sets, B. Show sets`);
    expect(screen.getByText('Round 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(`^Mark ${names[2]} set 1, A1 done`))).toBeTruthy();
  });

  it('the single Up next marker moves with the ticks (A1, B1, A2) and the dock says the same', async () => {
    const { names } = await mount(['g', 'g'], { restOff: false });
    const [a, b] = [names[0]!, names[1]!];
    expect(upNextOf([a, b])).toEqual([a]);
    await tick(a, 0, 'A1');
    expect(upNextOf([a, b])).toEqual([b]);
    expect(screen.getByText(`Next: B1 ${b}`)).toBeTruthy(); // the dock
    expect(live()).toBe(`Up next: ${b}, B1.`);
    await tick(b, 0, 'B1');
    expect(upNextOf([a, b])).toEqual([a]);
    expect(screen.getByText(`Next: A2 ${a}`)).toBeTruthy();
    expect(screen.getByText('Round 2 of 3')).toBeTruthy();
    expect(screen.getAllByText('Up next')).toHaveLength(1);
  });

  it('out of order: B1 before A1 puts the marker on A1, like the dock', async () => {
    const { names } = await mount(['g', 'g'], { restOff: false });
    await tick(names[1]!, 0, 'B1');
    expect(upNextOf([names[0]!, names[1]!])).toEqual([names[0]]);
    expect(screen.getByText(`Next: A1 ${names[0]}`)).toBeTruthy();
  });
});

describe('Ungroup', () => {
  it('dissolves the block, writes group: null on every member, keeps ticks, says so, and focuses the first former member', async () => {
    const { db, names } = await mount(['g', 'g']);
    await tick(names[0]!, 0, 'A1');
    await press(`Ungroup superset of ${names[0]} and ${names[1]}`);
    expect(screen.queryByLabelText(/^Superset: /)).toBeNull();
    expect(screen.queryByText('Up next')).toBeNull();
    expect(screen.getByText('Superset ungrouped')).toBeTruthy();
    expect(focusedText()).toBe(names[0]); // the first former member's heading
    expect(screen.getByLabelText(`Mark ${names[0]} set 1 done`).props.accessibilityState.checked).toBe(true); // ticks kept
    await waitFor(() => expect(stored(db).exercises.slice(0, 2).map((e) => e.group)).toEqual([null, null]));
    expect(stored(db).exercises[0]).toHaveProperty('group', null);
    // The block's chip comes back: ungrouped again.
    expect(screen.getByLabelText(`Superset ${names[0]} with ${names[1]}`)).toBeTruthy();
  });

  it('the dock stops using letters when the superset is dissolved', async () => {
    const { names } = await mount(['g', 'g'], { restOff: false });
    await tick(names[0]!, 0, 'A1');
    expect(screen.getByText(`Next: B1 ${names[1]}`)).toBeTruthy();
    await press(`Ungroup superset of ${names[0]} and ${names[1]}`);
    expect(screen.queryByText(`Next: B1 ${names[1]}`)).toBeNull();
    expect(screen.getByText(`Next: ${names[1]}`)).toBeTruthy();
  });
});

describe('removing a member', () => {
  it('from two: the group dissolves and the toast names the one left', async () => {
    const { names } = await mount(['g', 'g']);
    await press(`Remove exercise ${names[0]} from today`);
    await press(`Tap again to remove ${names[0]} from today`);
    expect(await screen.findByText(`${names[0]} removed. ${names[1]} is no longer in a superset.`)).toBeTruthy();
    expect(screen.queryByLabelText(/^Superset: /)).toBeNull();
  });

  it('from three: the block stays, the toast is plain and the live region says the new letters', async () => {
    const { names } = await mount(['g', 'g', 'g']);
    await press(`Remove exercise ${names[0]} from today`);
    await press(`Tap again to remove ${names[0]} from today`);
    expect(await screen.findByText(`${names[0]} removed`)).toBeTruthy();
    expect(live()).toBe('Superset is now A and B.');
    expect(block(new RegExp(`^Superset: ${names[1]} and ${names[2]}`))).toBeTruthy();
  });
});

it('announces on iOS instead of using a live region', async () => {
  const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  Platform.OS = 'ios';
  try {
    const { names } = await mount();
    await press(`Superset ${names[0]} with ${names[1]}`);
    expect(spy).toHaveBeenCalledWith(`${names[0]} and ${names[1]} are now a superset.`);
  } finally {
    spy.mockRestore();
  }
});
