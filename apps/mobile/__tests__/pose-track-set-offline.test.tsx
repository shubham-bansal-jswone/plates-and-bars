import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TrackSet } from '../src/pose/TrackSet';

// The camera view is loaded on demand: when that download fails (offline, a stale tab) the sheet says so and the set still works.
jest.mock('../src/pose/load', () => ({ loadPoseSession: () => Promise.reject(new Error('chunk failed')) }));

it('says so when the camera view cannot be loaded, and the sheet can be closed', async () => {
  const onApply = jest.fn();
  await render(<TrackSet name="Goblet Squat" sets={[{ done: false }]} onApply={onApply} available />);
  await fireEvent.press(screen.getByRole('button', { name: 'Track this set of Goblet Squat' }));
  expect(await screen.findByText('Tracking could not load. Check your connection and try again.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByText('Tracking could not load. Check your connection and try again.')).toBeNull());
  expect(onApply).not.toHaveBeenCalled();
});
