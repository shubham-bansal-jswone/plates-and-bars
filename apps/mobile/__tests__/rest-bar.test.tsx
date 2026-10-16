import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
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
    expect(screen.getByText('Rest 0:02').props.accessibilityLiveRegion).toBeUndefined();

    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByTestId('rest-announce').props.children).toBe('Rest done, go!');
    expect(screen.getByTestId('rest-announce').props.accessibilityLiveRegion).toBe('polite');
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

  it('hides the visible "Rest done, go!" from assistive tech once the timer ends, so only the live region says it', async () => {
    await render(<RestBar rest={{ id: 1, end: Date.now() + 2000, total: 2, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />);
    // While counting, the visible time stays readable.
    expect(screen.getByTestId('rest-title').props['aria-hidden']).toBeUndefined();
    expect(screen.getByText('Rest 0:02')).toBeOnTheScreen();

    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByTestId('rest-title', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
    // A swipe through the accessibility tree finds it once (the live region); the hidden visible copy is skipped.
    expect(screen.queryAllByText('Rest done, go!')).toHaveLength(1);
    expect(screen.queryAllByText('Rest done, go!', { includeHiddenElements: true })).toHaveLength(2);
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
