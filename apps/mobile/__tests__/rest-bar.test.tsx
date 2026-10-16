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
});

// At 1200 px the rest bar sat bottom-left (#147): it was absolutely placed 8 px from the left with no centring. It must sit
// under the content column (Page's column) instead. Layout is not computed under jest, so the flexbox rules that decide the
// bar's x position are applied by hand to the real styles: the dock spans the window, and centres a panel that is at most as
// wide as the column.
type Box = Record<string, number | string | undefined>;
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Box;

describe('RestBar on a wide window', () => {
  const WIDTH = 1200;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is centred under the content column, not at the left edge', async () => {
    await render(
      <Page>
        <Text>column content</Text>
        <RestBar rest={{ id: 1, end: Date.now() + 60000, total: 60, label: 'Next: set 2' }} onAdd={() => {}} onSkip={() => {}} />
      </Page>,
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

    // Resulting left edge at 1200 px: the column's, which Page centres in the window.
    const pad = Number(dock.padding ?? 0);
    const panelW = Math.min(Number(panel.maxWidth), WIDTH - 2 * pad);
    const panelLeft = Number(dock.left) + pad + (WIDTH - 2 * pad - panelW) / 2;
    const columnLeft = (WIDTH - Math.min(Number(column.maxWidth), WIDTH)) / 2;
    expect(panelLeft).toBe(columnLeft);
  });
});
