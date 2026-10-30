import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet, Text } from 'react-native';
import { Page } from '../src/components/ui';
import { RestBar } from '../src/workout/parts';

describe('RestBar live region', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is mounted empty and filled when the rest ends, so screen readers announce it; the countdown is not a live region', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 2000, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    const live = screen.getByTestId('rest-announce');
    expect(live.props.accessibilityLiveRegion).toBe('polite');
    expect(live.props.children).toBe('');
    expect(screen.getByLabelText('Rest 0:02').props.accessibilityLiveRegion).toBeUndefined();

    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByTestId('rest-announce').props.children).toBe('Rest done, go!');
    expect(screen.getByTestId('rest-announce').props.accessibilityLiveRegion).toBe('polite');
  });

  it('caps a long "Next:" line at two lines with an ellipsis and keeps the whole name in the spoken label (#1409)', async () => {
    const label = `Next: set 2 of ${'Single-arm cable crossover with a long pause at the bottom '.trim()} variation`;
    await render(<RestBar rest={{ id: 1, end: Date.now() + 5000, total: 5, label }} onAdd={() => {}} onSkip={() => {}} />);
    const next = screen.getByTestId('rest-next');
    expect(next.props.numberOfLines).toBe(2);
    expect(next.props.ellipsizeMode).toBe('tail');
    expect(next.props.accessibilityLabel).toBe(label);
    expect(next.props.accessibilityLiveRegion).toBe('polite');
  });

  it('centres the ring, Next line and buttons as one group in the dock column, which keeps the two-line cap (#1417)', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 5000, total: 5, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    const row = screen.getByLabelText('Rest timer');
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ justifyContent: 'center', maxWidth: 560 });
    // The side column wraps its content instead of growing to fill the row, so a short label does not leave the group left of centre.
    const side = screen.getByTestId('rest-next').parent;
    expect(StyleSheet.flatten(side?.props.style)).toMatchObject({ flexShrink: 1 });
    expect(StyleSheet.flatten(side?.props.style).flex).toBeUndefined();
    expect(screen.getByTestId('rest-next').props.numberOfLines).toBe(2);
  });

  it('draws a decorative ring with the percentage as its accessible label, 100 wide with a 7 stroke', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 1000, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    const ring = screen.getByLabelText(/^Rest \d+% done$/);
    expect(ring).toBeOnTheScreen();
    const arc = screen.getByTestId('ring-progress');
    expect(arc.props.strokeWidth).toBe(7);
    expect(StyleSheet.flatten(ring.parent?.props.style)).toMatchObject({ width: 100, height: 100 });
  });

  it('shows "Rest done, go!" small enough to sit inside the 100px ring, clear of the stroke (#1144)', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() - 1000, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    const style = StyleSheet.flatten(screen.getByTestId('rest-title').props.style);
    expect(style.fontSize).toBeLessThanOrEqual(14);
    expect(style.paddingHorizontal).toBeGreaterThanOrEqual(14);
    // At large system text the label must still fit as three short lines, so the scale is capped.
    expect(screen.getByTestId('rest-title').props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('caps text scaling on the countdown too, so it stays in the ring (#1144)', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 5000, total: 5, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    expect(screen.getByTestId('rest-title').props.maxFontSizeMultiplier).toBe(1.5);
  });

  it('hides the live region visually only: 1x1, negative margin, transparent, not touchable, and never display none', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 2000, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    const live = screen.getByTestId('rest-announce');
    const style = StyleSheet.flatten(live.props.style);
    expect(style).toMatchObject({ position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' });
    expect(style.display).toBeUndefined();
    // Hiding it from assistive tech would silence the announcement.
    expect(live.props['aria-hidden']).toBeUndefined();
  });

  // jest-expo runs as iOS; the Android and web branches set Platform.OS for the test and restore it after.
  describe('at zero, by platform', () => {
    const original = Platform.OS;
    afterEach(() => {
      Platform.OS = original;
      jest.restoreAllMocks();
    });
    // jest-expo already mocks AccessibilityInfo, so spyOn returns that shared mock: clear what earlier tests called on it.
    const spyAnnounce = () => jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockClear().mockImplementation(() => {});
    const rest = () => render(<RestBar rest={{ id: 1, end: Date.now() + 2000, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);

    it.each(['android', 'web'] as const)('%s: hides the visible "Rest done, go!" from assistive tech once the timer ends, so only the live region says it', async (os) => {
      Platform.OS = os;
      const announce = spyAnnounce();
      await rest();
      // While counting, the visible time stays readable.
      expect(screen.getByTestId('rest-title').props['aria-hidden']).toBeUndefined();
      expect(screen.getByLabelText('Rest 0:02')).toBeOnTheScreen();

      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.getByTestId('rest-title', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
      // A swipe through the accessibility tree finds it once (the live region); the hidden visible copy is skipped.
      expect(screen.queryAllByText('Rest done, go!')).toHaveLength(1);
      expect(screen.queryAllByText('Rest done, go!', { includeHiddenElements: true })).toHaveLength(2);
      // The live region speaks here, so there is no extra announcement.
      expect(announce).not.toHaveBeenCalled();
    });

    it('ios: keeps the visible text readable (the live region is Android-only and its transparent text is skipped) and announces once when the timer ends', async () => {
      Platform.OS = 'ios';
      const announce = spyAnnounce();
      await rest();
      expect(announce).not.toHaveBeenCalled();

      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.getByTestId('rest-title').props['aria-hidden']).toBeUndefined();
      expect(screen.getByTestId('rest-title')).toHaveTextContent('Rest done, go!');
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Rest done, go!');

      // Still at zero a second later: no repeat.
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(announce).toHaveBeenCalledTimes(1);
    });

    it('ios: announces again when +30 s re-arms the timer and it ends again', async () => {
      Platform.OS = 'ios';
      const announce = spyAnnounce();
      const view = await rest();
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(announce).toHaveBeenCalledTimes(1);
      await view.rerender(<RestBar rest={{ id: 1, end: Date.now() + 2000, total: 32, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
      await act(async () => { jest.advanceTimersByTime(600); });
      expect(screen.getByLabelText(/^Rest 0:0/)).toBeOnTheScreen();
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(announce).toHaveBeenCalledTimes(2);
    });
  });
});

// At 1200 px the rest bar sat bottom-left (#147): it was absolutely placed 8 px from the left with no centring. It must sit
// under the content column (Page's column) instead. Layout is not computed under jest, so this is a style guard: it pins the
// styles that carry the placement. The real check, the bar's bounding box against the column at 1200, 800 and 390 px, is the
// Playwright spec tests/e2e/specs/rest-bar.spec.mjs (#630).
type Box = Record<string, number | string | undefined>;
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Box;

describe('RestBar on a wide window', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is centred under the content column, not at the left edge', async () => {
    // As WorkoutScreen mounts it: next to the page body (outside the scrolling column), not inside it.
    await render(
      <>
        <Page>
          <Text>column content</Text>
        </Page>
        <RestBar rest={{ id: 1, end: Date.now() + 60000, total: 60, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />
      </>,
    );
    const panel = flat(screen.getByLabelText('Rest timer'));
    const dock = flat(screen.getByLabelText('Rest timer').parent as never);
    const column = flat(screen.getByText('column content').parent as never);

    // The panel sits in a dock that spans the window edge to edge and centres it.
    expect(dock.position).toBe('absolute');
    expect(dock.left).toBe(0);
    expect(dock.right).toBe(0);
    expect(dock.alignItems).toBe('center');
    expect(panel.position).toBeUndefined();

    // Same maximum width as the column the page content sits in, so the bar lines up with the cards above it.
    expect(panel.width).toBe('100%');
    expect(panel.maxWidth).toBe(column.maxWidth);
  });
});
