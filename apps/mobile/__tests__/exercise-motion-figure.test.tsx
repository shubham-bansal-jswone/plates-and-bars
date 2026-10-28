import { AccessibilityInfo, AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored } from '../src/content/store';
import { ExerciseFigure } from '../src/workout/ExerciseFigure';
import { getCatalog } from '../src/workout/catalog';
import { motionAlt } from '../src/motion/data';
import { setReducedMotionForTests } from '../src/components/reducedMotion';
import { MOTION_ENTRY_NAME, motionFixtureBundle } from './motion-helpers';
import { openDb } from './sync-helpers';

// useFocusEffect runs its callback on mount; `focus()` and `blur()` stand in for the navigator showing or covering the screen.
const mockFocus: { cb: (() => (() => void) | void) | null; cleanup: (() => void) | void } = { cb: null, cleanup: undefined };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (cb: () => (() => void) | void) => { useEffect(() => { mockFocus.cb = cb; mockFocus.cleanup = cb(); return () => mockFocus.cleanup?.(); }, [cb]); },
  };
});
const blur = () => { mockFocus.cleanup?.(); mockFocus.cleanup = undefined; };
const focus = () => { mockFocus.cleanup = mockFocus.cb?.(); };

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><circle cx="80" cy="20" r="10" fill="var(--fig-body)"/></svg>';
const images = () => ({
  schema_version: 1,
  images: {
    [MOTION_ENTRY_NAME]: {
      frames: ['a', 'b'].map((x) => ({ file: `svg/squat-${x}.svg`, w: 160, h: 120, svg: SVG })),
      source: 'own_drawing', source_id: 'rig-v1/squat', licence: 'CC-BY-4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/',
      author: 'Plate & Bar authors', author_url: null, source_url: null, changes: null, alt: null, note: null,
    },
  },
});
async function launch(motion: unknown): Promise<void> {
  const db = await openDb();
  for (const [name, body] of [['exercise-images', images()], ['exercise-motion', motion]] as const) {
    await putStored(db, { name, sha256: 'x', schema_version: BUNDLED[name]!.schema_version, updated_at: '2099-01-01T00:00:00Z', body: JSON.stringify(body) });
  }
  await loadContent(db);
}
/** The drawn limb segments: x1, y1, x2, y2 of every line in the rendered tree. */
function lines(): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.props && 'x1' in n.props && 'y2' in n.props) out.push([n.props.x1, n.props.y1, n.props.x2, n.props.y2].join(','));
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}
const reduced = (on: boolean) => {
  setReducedMotionForTests(on); // the app asks once at load; here each test is its own system
  return jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(on);
};
/** Intervals set and not yet cleared: the player's tick is the only one this screen starts. */
const openIntervals = new Set<unknown>();
const playerTimers = () => openIntervals.size;
async function show(): Promise<void> {
  await render(<ExerciseFigure name={MOTION_ENTRY_NAME} />);
  await act(async () => { await Promise.resolve(); });
}
const setup0 = () => getCatalog().cards[MOTION_ENTRY_NAME]?.setup[0];

beforeEach(async () => {
  jest.useFakeTimers();
  openIntervals.clear();
  const set = globalThis.setInterval;
  const clear = globalThis.clearInterval;
  jest.spyOn(globalThis, 'setInterval').mockImplementation(((...a: Parameters<typeof set>) => { const id = set(...a); openIntervals.add(id); return id; }) as never);
  jest.spyOn(globalThis, 'clearInterval').mockImplementation(((id: Parameters<typeof clear>[0]) => { openIntervals.delete(id); clear(id); }) as never);
  process.env.EXPO_PUBLIC_EXERCISE_MOTION = '1';
  reduced(false);
  await launch(motionFixtureBundle());
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_EXERCISE_MOTION;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ExerciseFigure with the exercise-motion flag', () => {
  it('flag off: the v1.1 start and end frames, no player', async () => {
    delete process.env.EXPO_PUBLIC_EXERCISE_MOTION;
    await show();
    expect(screen.getByTestId('figure-row')).toBeTruthy();
    expect(screen.getAllByTestId('figure-frame', { includeHiddenElements: true })).toHaveLength(2);
    expect(screen.queryByTestId('motion-figure')).toBeNull();
  });
  it('flag on but the exercise has no motion entry: the v1.1 frames', async () => {
    await launch({ ...(motionFixtureBundle() as object), motions: {} });
    await show();
    expect(screen.getByTestId('figure-row')).toBeTruthy();
    expect(screen.queryByTestId('motion-figure')).toBeNull();
  });
  it('flag on with an invalid bundle: the v1.1 frames', async () => {
    await launch({ ...(motionFixtureBundle() as object), skeleton: 'other' });
    await show();
    expect(screen.getByTestId('figure-row')).toBeTruthy();
    expect(screen.queryByTestId('motion-figure')).toBeNull();
  });
  it('flag on with an entry: the player replaces the pair, with alt text and the credit link', async () => {
    await show();
    expect(screen.queryByTestId('figure-row')).toBeNull();
    const fig = screen.getByTestId('motion-figure');
    expect(fig.props.accessibilityLabel).toBe(motionAlt(MOTION_ENTRY_NAME, false, setup0()));
    expect(fig.props.accessibilityRole).toBe('image');
    expect(screen.getByLabelText('Motion: Test Author (CC BY 4.0). Opens About and sources')).toBeTruthy();
    expect(lines().length).toBeGreaterThanOrEqual(6);
  });
  it('animates: the pose changes as time passes', async () => {
    await show();
    const start = lines().join('|');
    await act(async () => { jest.advanceTimersByTime(500); });
    const later = lines().join('|');
    expect(later).not.toBe(start);
  });
  it('reduced motion: one static key pose, nothing moves, no timer runs, alt says key position', async () => {
    reduced(true);
    await show();
    const still = lines().join('|');
    expect(screen.getByTestId('motion-figure').props.accessibilityLabel).toBe(motionAlt(MOTION_ENTRY_NAME, true, setup0()));
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(lines().join('|')).toBe(still);
    expect(playerTimers()).toBe(0);
    expect(screen.queryByLabelText('Pause animation')).toBeNull();
  });
  it('pauses and plays from a labelled button', async () => {
    await show();
    await act(async () => { jest.advanceTimersByTime(300); });
    await fireEvent.press(screen.getByLabelText('Pause animation'));
    const held = lines().join('|');
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(lines().join('|')).toBe(held);
    await fireEvent.press(screen.getByLabelText('Play animation'));
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(lines().join('|')).not.toBe(held);
  });
  it('stops its timer when the app goes to the background and when it unmounts', async () => {
    let onChange: (s: string) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => { onChange = cb; return { remove: jest.fn() }; }) as never);
    await show();
    expect(playerTimers()).toBe(1);
    await act(async () => onChange('background'));
    expect(playerTimers()).toBe(0);
    await act(async () => onChange('active'));
    expect(playerTimers()).toBe(1);
    await screen.unmount();
    expect(playerTimers()).toBe(0);
  });
  it('stops its timer when the screen loses focus and starts it again on focus', async () => {
    await show();
    expect(playerTimers()).toBe(1);
    await act(async () => { jest.advanceTimersByTime(300); });
    await act(async () => blur());
    expect(playerTimers()).toBe(0);
    const held = lines().join('|');
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(lines().join('|')).toBe(held);
    await act(async () => focus());
    expect(playerTimers()).toBe(1);
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(lines().join('|')).not.toBe(held);
  });
  it('before the system answers about reduced motion: frame 0, the moving alt text, no timer and no Pause button', async () => {
    setReducedMotionForTests(undefined);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => {}));
    await render(<ExerciseFigure name={MOTION_ENTRY_NAME} />);
    expect(playerTimers()).toBe(0);
    expect(screen.queryByLabelText('Pause animation')).toBeNull();
    expect(screen.getByTestId('motion-figure').props.accessibilityLabel).toBe(motionAlt(MOTION_ENTRY_NAME, false, setup0()));
    const first = lines().join('|');
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(lines().join('|')).toBe(first);
  });
});
