import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { dark, light } from '../src/theme/tokens';
import { followsSystemTheme, useTheme } from '../src/theme/useTheme';

let mockScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));

function Probe() {
  return <Text testID="bg">{useTheme().bg}</Text>;
}

const bgOf = (r: { toJSON: () => unknown }) => (r.toJSON() as { children: string[] }).children[0];
const OLD = process.env.EXPO_PUBLIC_THEME;
afterEach(() => {
  if (OLD === undefined) delete process.env.EXPO_PUBLIC_THEME;
  else process.env.EXPO_PUBLIC_THEME = OLD;
});

describe('theme default', () => {
  it.each(['light', 'dark', null] as const)('is the dark identity when the system says %s', async (scheme) => {
    delete process.env.EXPO_PUBLIC_THEME;
    mockScheme = scheme;
    expect(followsSystemTheme()).toBe(false);
    expect(bgOf(await render(<Probe />))).toBe(dark.bg);
  });

  it.each([['light', light.bg], ['dark', dark.bg]] as const)('follows a %s system with EXPO_PUBLIC_THEME=system (light keeps working)', async (scheme, bg) => {
    process.env.EXPO_PUBLIC_THEME = 'system';
    mockScheme = scheme;
    expect(followsSystemTheme()).toBe(true);
    expect(bgOf(await render(<Probe />))).toBe(bg);
  });

  it('only exactly "system" turns it on', () => {
    expect(followsSystemTheme('System')).toBe(false);
    expect(followsSystemTheme('1')).toBe(false);
    expect(followsSystemTheme('')).toBe(false);
  });

  it('dark uses the mandated identity colours', () => {
    expect([dark.bg, dark.surface, dark.brand, dark.ink, dark.subtle, dark.danger]).toEqual(['#090B09', '#151915', '#B7FF00', '#F5F7F2', '#777F76', '#FF5252']);
  });
});
