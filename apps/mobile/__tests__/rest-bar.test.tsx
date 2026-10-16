import { act, render, screen } from '@testing-library/react-native';
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
