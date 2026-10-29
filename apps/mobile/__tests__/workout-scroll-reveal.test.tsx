import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { WorkoutScreen } from '../src/screens/WorkoutScreen';
import { setReducedMotionForTests } from '../src/components/reducedMotion';
import { saveProfile } from '../src/db/records';
import { saveSettings } from '../src/db/settings';
import { defaultSettings } from '../src/settings/types';
import { buildProfile, emptyDraft } from '../src/setup/logic';
import { DOCK_FALLBACK_H, DOCK_SPACER_MARGIN } from '../src/workout/parts';
import { revealDelta } from '../src/workout/scrollIntoView';
import type { Workout } from '../src/workout/types';
import { press } from './disclosure-helpers';
import { memoryDb, withProfile } from './helpers';

// One scroll mechanism for the session: the up-next set of a superset (#1343) and the finish question (#1344) are brought above the rest dock.
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, []) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

const THU = () => new Date(2026, 9, 8, 10, 0, 0);
const DATE = '2026-10-08';
const profile = buildProfile({ ...emptyDraft(), sex: 'male', age: '30', unit: 'cm', cm: '165', weight: '82', activity: 'sitting', where: 'gym', days: 6, exp: 'some', minutes: 60, goal: 'lose', pace: 'moderate', screen: ['no', 'no', 'no', 'no', 'no', 'no'] }, new Date(2026, 8, 1));
const VIEW_H = 700; // the page: top 0, 700 high
// Layout is mocked: the page (the scroll view, which the jest mock lets share View's measure) is 700 high; any other node asked is the one being revealed, at `nodeTop`, 100 high.
let nodeTop = 0;
let scrollY = 0; // where the page is scrolled to: its content starts that far above the page
const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
const measured = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation(function (this: { props: object }, ...args: unknown[]) {
  const cb = args[0] as (x: number, y: number, w: number, h: number) => void;
  if ('contentContainerStyle' in this.props) cb(0, 0, 375, VIEW_H);
  else cb(0, nodeTop, 300, 100);
});
// The page's inner content view: its window top is the page top less the offset (react-native-web and native both have it; jest's mock does not).
(ScrollView.prototype as unknown as { getInnerViewRef: () => unknown }).getInnerViewRef = () => ({ measureInWindow: (cb: (x: number, y: number) => void) => cb(0, -scrollY) });
const focus = jest.spyOn(TextInput.prototype, 'focus');
beforeEach(() => {
  scrollTo.mockClear();
  measured.mockClear();
  focus.mockClear();
  scrollY = 0;
  setReducedMotionForTests(undefined);
});

async function mount(groups: (string | null)[], restOff: boolean) {
  const db = memoryDb();
  await saveSettings(db, { ...defaultSettings('2026-10-08T00:00:00Z'), rest_off: restOff });
  await saveProfile(db, { ...profile, where: 'gym' });
  const first = await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  await press('Start Push B');
  await waitFor(() => expect(db.rows.get(`workouts:${DATE}`)).toBeTruthy());
  await first.unmount();
  const w = JSON.parse(db.rows.get(`workouts:${DATE}`) as string) as Workout;
  db.rows.set(`workouts:${DATE}`, JSON.stringify({ ...w, exercises: w.exercises.map((e, i) => ({ ...e, skip_ramp: true, ...(groups[i] ? { group: groups[i] } : {}) })), updated_at: '2026-10-08T09:30:00Z' }));
  await render(withProfile(db, <WorkoutScreen db={db} now={THU} />));
  const names = w.exercises.map((e) => e.name);
  await screen.findAllByLabelText(`Add set to ${names[0]}`);
  scrollTo.mockClear();
  measured.mockClear();
  return names;
}
async function tick(name: string, j: number, tag: string) {
  const [wf, rf] = screen.getAllByLabelText(new RegExp(`^${name} set ${j + 1}, ${tag} `));
  await fireEvent.changeText(wf!, '40');
  await fireEvent.changeText(rf!, '10');
  await press(new RegExp(`^Mark ${name} set ${j + 1}, ${tag} done`));
}
/** The rest dock's layout (jest lays nothing out): its height, as the dock of the current rest reports it. */
const layout = (h: number) => fireEvent(screen.getByLabelText('Rest timer'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 375, height: h } } });
async function tickUngrouped(name: string) {
  await fireEvent.changeText(screen.getByLabelText(`${name} set 1 kg`), '10');
  await fireEvent.changeText(screen.getByLabelText(`${name} set 1 reps`), '10');
  await press(`Mark ${name} set 1 done`);
}

describe('revealDelta', () => {
  it('is 0 inside the visible part, which ends above the dock', () => {
    expect(revealDelta(100, 100, 0, 700, DOCK_FALLBACK_H)).toBe(0);
    expect(revealDelta(430, 100, 0, 700, DOCK_FALLBACK_H)).toBe(0); // bottom at 530, edge at 542
  });
  it('scrolls down just enough to clear the dock and an 8 px edge', () => {
    expect(revealDelta(600, 100, 0, 700, DOCK_FALLBACK_H)).toBe(158); // 700 - (700 - 150 - 8)
    expect(revealDelta(600, 100, 0, 700, 0)).toBe(8);
  });
  it('brings a node above the page, or one taller than the visible part, to the top edge', () => {
    expect(revealDelta(-50, 100, 0, 700, DOCK_FALLBACK_H)).toBe(-58);
    expect(revealDelta(300, 900, 0, 700, DOCK_FALLBACK_H)).toBe(292);
  });
  it('counts from the scroll view top, not the window top', () => {
    expect(revealDelta(120, 100, 100, 600, 0)).toBe(0);
    expect(revealDelta(90, 100, 100, 600, 0)).toBe(-18);
  });
});

describe('the up-next set in a superset of 3 (#1343)', () => {
  it('scrolls the row above the dock after a tick when it is off-screen, without animation under reduced motion', async () => {
    setReducedMotionForTests(true);
    const names = await mount(['g', 'g', 'g'], false);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    await layout(DOCK_FALLBACK_H);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 1000 - (VIEW_H - DOCK_FALLBACK_H - 8), animated: false });
    expect(focus).not.toHaveBeenCalled(); // never a weight field
  });

  it('adds the offset the page is already scrolled to', async () => {
    setReducedMotionForTests(true);
    const names = await mount(['g', 'g', 'g'], false);
    scrollY = 300;
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    await layout(DOCK_FALLBACK_H);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 300 + 1000 - (VIEW_H - DOCK_FALLBACK_H - 8), animated: false });
  });

  it('does not animate while reduced motion is not known yet', async () => {
    setReducedMotionForTests(undefined);
    const names = await mount(['g', 'g', 'g'], false);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    await layout(DOCK_FALLBACK_H);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ animated: false }));
  });

  it('never scrolls to a negative offset', async () => {
    const names = await mount(['g', 'g', 'g'], false);
    scrollY = 20;
    nodeTop = -50; // the delta is -58, more than the page is scrolled
    await tick(names[0]!, 0, 'A1');
    await layout(DOCK_FALLBACK_H);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
  });

  it('sizes the page spacer from the measured dock, 184 until then', async () => {
    const names = await mount(['g', 'g', 'g'], false);
    const spacer = () => StyleSheet.flatten(screen.getByTestId('dock-spacer').props.style).height;
    expect(spacer()).toBe(DOCK_FALLBACK_H + DOCK_SPACER_MARGIN);
    await tick(names[0]!, 0, 'A1');
    await layout(240);
    expect(spacer()).toBe(240 + DOCK_SPACER_MARGIN);
  });

  it('animates the scroll when reduced motion is off', async () => {
    setReducedMotionForTests(false);
    const names = await mount(['g', 'g', 'g'], false);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    await layout(DOCK_FALLBACK_H);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ animated: true })));
  });

  it('does not scroll when the row is already visible', async () => {
    const names = await mount(['g', 'g', 'g'], false);
    nodeTop = 100;
    await tick(names[0]!, 0, 'A1');
    await layout(DOCK_FALLBACK_H);
    await waitFor(() => expect(measured).toHaveBeenCalled());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('keeps no room for a dock that is not up (rest off)', async () => {
    const names = await mount(['g', 'g', 'g'], true);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 1000 - (VIEW_H - 8) }));
  });

  it('does nothing for an ungrouped session when a set is ticked', async () => {
    const names = await mount([], false);
    nodeTop = 900;
    await tickUngrouped(names[0]!);
    await screen.findByText(/1 of \d+ sets done/);
    expect(measured).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('the dock of a new rest', () => {
  beforeEach(() => setReducedMotionForTests(true));

  it('holds the reveal until the dock is laid out, then scrolls once with its height', async () => {
    const names = await mount(['g', 'g', 'g'], false);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    expect(scrollTo).not.toHaveBeenCalled();
    await layout(240);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 1000 - (VIEW_H - 240 - 8), animated: false });
  });

  it('scrolls at once when the dock of the current rest is already measured', async () => {
    const names = await mount([], false);
    await tickUngrouped(names[0]!);
    await layout(240);
    scrollTo.mockClear();
    nodeTop = 640;
    await press('Complete workout');
    await screen.findByText(/^Finish with 1 of/);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 740 - (VIEW_H - 240 - 8) }));
  });

  it('scrolls at once, with no clearance, when no rest is up', async () => {
    const names = await mount(['g', 'g', 'g'], true);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 1000 - (VIEW_H - 8) }));
  });

  it('does not scroll when the dock changes height later, with nothing waiting', async () => {
    const names = await mount(['g', 'g', 'g'], false);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1');
    await layout(150);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    await layout(300); // a relabel, a font loading: the user may have scrolled since
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('leaves nothing waiting when its rest ends before the layout', async () => {
    const names = await mount(['g', 'g', 'g', null], false);
    nodeTop = 900;
    await tick(names[0]!, 0, 'A1'); // the reveal waits for this rest's dock
    await press('Skip'); // the rest ends first
    expect(scrollTo).not.toHaveBeenCalled();
    await press(`${names[3]}, 0/3 sets. Show sets`); // a set outside the block starts a new rest and moves no marker
    await tickUngrouped(names[3]!);
    await layout(240);
    expect(scrollTo).not.toHaveBeenCalled(); // the old node is not revealed against this dock
  });
});

describe('the finish question (#1344)', () => {
  it('is scrolled above the dock when it opens, and stays put when it already shows', async () => {
    const names = await mount([], false);
    await tickUngrouped(names[0]!);
    await screen.findByText(/1 of \d+ sets done/);
    await layout(DOCK_FALLBACK_H);
    scrollTo.mockClear();
    nodeTop = 640;
    await press('Complete workout');
    await screen.findByText(/^Finish with 1 of/);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 740 - (VIEW_H - DOCK_FALLBACK_H - 8) }));
    expect(focus).not.toHaveBeenCalled();
    await press('Keep going');
    scrollTo.mockClear();
    nodeTop = 100;
    await press('Complete workout');
    await screen.findByText(/^Finish with 1 of/);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
