import { render, screen } from '@testing-library/react-native';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { bumpStoreEpoch, revertStoreEpoch, storeEpoch } from '../src/db/storeEpoch';
import { postToast, resetPendingToast, usePendingToast } from '../src/state/pendingToast';

// `focused` stands for the screen being shown; a hidden screen's focus effect does not run.
let mockFocused = true;
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(() => (mockFocused ? cb() : undefined), [cb]),
}));

function Probe() {
  const [m, setM] = useState('');
  usePendingToast(useCallback((x: string) => setM(x), []));
  return <Text>{m ? `toast: ${m}` : 'no toast'}</Text>;
}

beforeEach(() => {
  mockFocused = true;
  resetPendingToast();
});

describe('pending toast', () => {
  it('is not taken by a hidden screen, and is shown when the screen is focused', async () => {
    postToast('Targets updated');
    mockFocused = false;
    const hidden = await render(<Probe />);
    expect(screen.getByText('no toast')).toBeTruthy();
    await hidden.unmount();
    mockFocused = true;
    await render(<Probe />);
    expect(screen.getByText('toast: Targets updated')).toBeTruthy();
  });

  it('is dropped when the store was wiped after it was posted', async () => {
    const before = storeEpoch();
    postToast('Targets updated');
    bumpStoreEpoch();
    try {
      await render(<Probe />);
      expect(screen.getByText('no toast')).toBeTruthy();
    } finally {
      revertStoreEpoch(before);
    }
  });
});
