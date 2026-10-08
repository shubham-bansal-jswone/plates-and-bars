import { render, screen } from '@testing-library/react-native';
import { calcTargets } from '@plate-and-bar/core';
import golden from '../../../docs/spec/golden/targets.json';
import { DEMO_PROFILE, TargetsScreen } from '../src/screens/TargetsScreen';

const g = golden.find((c) => c.input.id === 'male-30-lose-moderate')!;
const { id: _id, ...goldenInput } = g.input;

describe('TargetsScreen', () => {
  it('uses the golden input as its demo profile', () => {
    expect(DEMO_PROFILE).toEqual(goldenInput);
    expect(calcTargets(DEMO_PROFILE).kcal).toBe(g.output.kcal);
  });

  it('shows the golden kcal target, en-IN formatted', async () => {
    await render(<TargetsScreen />);
    expect(g.output.kcal).toBe(1990);
    expect(screen.getByTestId('kcal')).toHaveTextContent('1,990 kcal');
    expect(screen.getByText(`${g.output.protein} g`)).toBeTruthy();
  });
});
