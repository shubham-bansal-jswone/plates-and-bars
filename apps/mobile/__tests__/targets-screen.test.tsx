import { render, screen } from '@testing-library/react-native';
import { calcTargets } from '@plate-and-bar/core';
import { DEMO_PROFILE, TargetsScreen } from '../src/screens/TargetsScreen';

describe('TargetsScreen', () => {
  it('shows the kcal target computed by packages/core', async () => {
    await render(<TargetsScreen />);
    // 1990 is the value in docs/spec/golden/targets.json for male-30-lose-moderate.
    expect(screen.getByTestId('kcal')).toHaveTextContent('1990 kcal');
    expect(calcTargets(DEMO_PROFILE).kcal).toBe(1990);
    expect(screen.getByText('150 g')).toBeTruthy();
  });
});
