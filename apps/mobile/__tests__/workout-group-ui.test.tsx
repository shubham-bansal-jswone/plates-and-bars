import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import type { Workout } from '../src/workout/types';
import { focusNode } from '../src/labelscan/focus';
import { ringUntilBlur } from '../src/workout/focusRing';
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
async function mount(groups: (string | null)[] = [], o: { restOff?: boolean; ramp?: boolean; rampOnly?: number; secondFrom?: number; dupe?: boolean } = {}) {
  const db = memoryDb();
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: o.restOff ?? true });
  await saveProfile(db, { ...profile, where: 'gym' });
  const first = await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  await press('Start Push B');
  await waitFor(() => expect(db.rows.get(`workouts:${DATE}`)).toBeTruthy());
  await first.unmount();
  const w = stored(db);
  db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, exercises: w.exercises.map((e, i) => ({ ...e, ...(o.dupe && i === 3 ? { name: w.exercises[0]!.name } : {}), skip_ramp: o.rampOnly !== undefined ? i !== o.rampOnly : !o.ramp, ...(o.secondFrom !== undefined && i >= o.secondFrom ? { part: 2 as const } : {}), ...(groups[i] ? { group: groups[i] } : {}) })), updated_at: '2026-10-08T09:30:00Z' }));
  await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  const names = stored(db).exercises.map((e) => e.name);
  await screen.findAllByLabelText(`Add set to ${names[0]}`);
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
    await press(`Superset with next: ${names[1]}`);
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
    expect(screen.queryByLabelText(`Superset with next: ${names[1]}`)).toBeNull();
    expect(screen.getByLabelText(`Superset with next: ${names[2]}`)).toBeTruthy();
  });

  it('is disabled with the reason as visible text and as the accessibility hint: a finished exercise, the first-time ramp', async () => {
    const ramp = await mount([], { ramp: true });
    const rc = screen.getByLabelText(`Superset with next: ${ramp.names[1]}`);
    expect(rc.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(`Finish the first-time ramp for ${ramp.names[0]} first.`)).toBeTruthy();
  });

  it('is hidden when the next exercise is in the second session', async () => {
    const { names } = await mount([], { secondFrom: 1 });
    expect(screen.queryByLabelText(`Superset with next: ${names[1]}`)).toBeNull();
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
    const chip = await screen.findByLabelText(`Superset with next: ${second}`);
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
    expect(screen.getByLabelText(`${names[2]}, 0/3 sets, A, up next. Show sets`)).toBeTruthy();
    expect(screen.getByLabelText(`${names[3]}, 0/3 sets, B. Show sets`)).toBeTruthy();
    expect(screen.getByText('0 of 3 rounds done')).toBeTruthy();
    // The collapsed member holding the up-next set says so (its badge is filled): A here, not B.
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
    expect(screen.getByLabelText(`Superset with next: ${names[1]}`)).toBeTruthy();
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
    await press(`Superset with next: ${names[1]}`);
    expect(spy).toHaveBeenCalledWith(`${names[0]} and ${names[1]} are now a superset.`);
  } finally {
    spy.mockRestore();
  }
});

describe('review round 2', () => {
  it('a name stored twice shows once (#1340: a session never holds one name twice); that one can be ticked', async () => {
    const { names } = await mount([], { dupe: true });
    expect(names[3]).toBe(names[0]); // the stored row repeats the name; the screen shows it once, at its first place
    expect(screen.getAllByLabelText(`Add set to ${names[0]}`)).toHaveLength(1);
    const marks = screen.getAllByLabelText(new RegExp(`^Mark ${names[0]} set 1 done`));
    expect(marks).toHaveLength(1);
    await fireEvent.changeText(screen.getAllByLabelText(new RegExp(`^${names[0]} set 1 (kg|reps|\\+|Assist)`))[0]!, '40');
    await fireEvent.changeText(screen.getAllByLabelText(new RegExp(`^${names[0]} set 1 reps`))[0]!, '9');
    await fireEvent.press(marks[0]!);
    expect(screen.getAllByLabelText(new RegExp(`^Mark ${names[0]} set 1 done`))[0]!.props.accessibilityState.checked).toBe(true);
  });

  it('exactly one set in the block is current after a tick (one lime ring)', async () => {
    const { names } = await mount(['g', 'g'], { restOff: true });
    const colours = () => {
      const undone = screen.getAllByLabelText(/^Mark .* set \d, [AB]\d done/).filter((m) => !m.props.accessibilityState.checked);
      const count = new Map<unknown, number>();
      for (const m of undone) {
        const c = StyleSheet.flatten(typeof m.props.style === 'function' ? m.props.style({ pressed: false }) : m.props.style).borderColor;
        count.set(c, (count.get(c) ?? 0) + 1);
      }
      return [...count.values()].sort();
    };
    expect(colours()).toEqual([1, 5]);
    await tick(names[0]!, 0, 'A1');
    expect(colours()).toEqual([1, 4]); // B1 only; without the block-wide marker A2 would be a second one
  });

  it('the next exercise on its first-time ramp disables the chip with that exercise\'s name', async () => {
    const { names } = await mount([], { rampOnly: 1 });
    const chip = screen.getByLabelText(`Superset with next: ${names[1]}`);
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(`Finish the first-time ramp for ${names[1]} first.`)).toBeTruthy();
  });

  it('the letter badge is hidden from screen readers', async () => {
    await mount(['g', 'g']);
    const badges = screen.getAllByText('A', { includeHiddenElements: true });
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b.parent!.props['aria-hidden']).toBe(true);
  });

  it('the chip is not offered under an exercise that is itself finished', async () => {
    const { names } = await mount();
    for (let j = 1; j <= 3; j++) {
      const [w, r] = screen.getAllByLabelText(new RegExp(`^${names[0]} set ${j} `));
      await fireEvent.changeText(w!, '40');
      await fireEvent.changeText(r!, '10');
      await press(`Mark ${names[0]} set ${j} done`);
    }
    expect(screen.queryByLabelText(`Superset with next: ${names[1]}`)).toBeNull();
    expect(screen.queryByText(/is already done/)).toBeNull();
  });

  it('a finished block has no up-next cue anywhere: no filled badge, no caption, no announcement (the dock goes on to the next exercise)', async () => {
    const { names } = await mount(['g', 'g'], { restOff: false });
    const [a, b] = [names[0]!, names[1]!];
    for (let j = 0; j < 3; j++) {
      await tick(a, j, `A${j + 1}`);
      await tick(b, j, `B${j + 1}`);
    }
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText('Up next')).toBeNull();
    expect(upNextOf([a, b])).toEqual([]);
    expect(live()).not.toMatch(/Up next/);
    expect(screen.getByText(`Next: ${names[2]}`)).toBeTruthy();
  });

  it('the chip is hidden on a finished last member even when it would otherwise offer a merge', async () => {
    const { names } = await mount(['g', 'g', 'h', 'h']);
    const merge = new RegExp(`^Merge with the next superset, which starts with ${names[2]}`);
    expect(screen.getByLabelText(merge)).toBeTruthy(); // the merge offer, on the last member
    for (let j = 0; j < 3; j++) await tick(names[1]!, j, `B${j + 1}`);
    expect(screen.queryByLabelText(merge)).toBeNull();
  });

  it('a member that joins a ticked group is announced as joining, not as a move of the marker', async () => {
    const { names } = await mount(['g', 'g', null]);
    await tick(names[0]!, 0, 'A1');
    await tick(names[1]!, 0, 'B1'); // the marker is on A2 and moves to C1 when C joins: that move must not be announced
    await press(`Superset with next: ${names[2]}`);
    expect(live()).toBe(`${names[0]}, ${names[1]} and ${names[2]} are now a superset.`);
    expect(upNextOf(names.slice(0, 3))).toEqual([names[2]]);
  });
});

describe('an untick in a superset while a rest runs', () => {
  it('moves the marker and the dock together to the unticked set', async () => {
    const { names } = await mount(['g', 'g'], { restOff: false });
    const [a, b] = [names[0]!, names[1]!];
    await tick(a, 0, 'A1');
    expect(screen.getByText(`Next: B1 ${b}`)).toBeTruthy();
    await press(new RegExp(`^Mark ${a} set 1, A1 done`)); // untick
    expect(upNextOf([a, b])).toEqual([a]);
    expect(screen.getByText(`Next: A1 ${a}`)).toBeTruthy();
    expect(screen.getAllByLabelText('Rest timer')).toHaveLength(1); // still the one rest: an untick starts none
  });

  it('after the whole block is done, unticking B3 puts both on B3', async () => {
    const { names } = await mount(['g', 'g'], { restOff: false });
    const [a, b] = [names[0]!, names[1]!];
    for (let j = 0; j < 3; j++) {
      await tick(a, j, `A${j + 1}`);
      await tick(b, j, `B${j + 1}`);
    }
    expect(screen.getByText(`Next: ${names[2]}`)).toBeTruthy();
    await press(new RegExp(`^Mark ${b} set 3, B3 done`));
    expect(upNextOf([a, b])).toEqual([b]);
    expect(screen.getByText(`Next: B3 ${b}`)).toBeTruthy();
  });
});

describe('an untick after a rest that came from outside the superset', () => {
  it('[X, (A, B)]: tick A1, finish X (rest: Next B1), untick A1: marker and dock on A1', async () => {
    const { names } = await mount([null, 'g', 'g'], { restOff: false });
    const [x, a, b] = [names[0]!, names[1]!, names[2]!];
    await press(`${a}, 0/3 sets, A, up next. Show sets`);
    await tick(a, 0, 'A1');
    await press(`${x}, 0/3 sets. Show sets`);
    for (let j = 1; j <= 3; j++) {
      const [w, r] = screen.getAllByLabelText(new RegExp(`^${x} set ${j} `));
      await fireEvent.changeText(w!, '40');
      await fireEvent.changeText(r!, '10');
      await press(`Mark ${x} set ${j} done`);
    }
    expect(screen.getByText(`Next: B1 ${b}`)).toBeTruthy();
    await press(`${a}, 1/3 sets, A. Show sets`);
    await press(new RegExp(`^Mark ${a} set 1, A1 done`));
    expect(upNextOf([a, b])).toEqual([a]);
    expect(screen.getByText(`Next: A1 ${a}`)).toBeTruthy();
  });
});

describe('ringUntilBlur', () => {
  it('draws the ring and removes it on blur', () => {
    let blur = () => {};
    const el = { style: { outline: '', outlineOffset: '' }, addEventListener: (_: string, f: () => void) => void (blur = f) };
    ringUntilBlur(el as never, '#123456');
    expect(el.style.outline).toBe('2px solid #123456');
    blur();
    expect(el.style.outline).toBe('');
  });
});
