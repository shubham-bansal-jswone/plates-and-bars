import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { dark, light } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

let mockScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));

function Probe() {
  return <Text testID="bg">{useTheme().bg}</Text>;
}

const bgOf = (r: { toJSON: () => unknown }) => (r.toJSON() as { children: string[] }).children[0];

describe('theme follows the system', () => {
  it.each([['light', light.bg], ['dark', dark.bg], [null, light.bg]] as const)('system %s gives the matching palette', async (scheme, bg) => {
    mockScheme = scheme;
    expect(bgOf(await render(<Probe />))).toBe(bg);
  });

  it('dark uses the mandated identity colours', () => {
    expect([dark.bg, dark.surface, dark.brand, dark.ink, dark.subtle, dark.danger]).toEqual(['#090B09', '#151915', '#B7FF00', '#F5F7F2', '#777F76', '#FF5252']);
  });
});
