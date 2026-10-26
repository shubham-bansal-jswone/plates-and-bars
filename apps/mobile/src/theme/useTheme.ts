import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

/** True when the build follows the system colour scheme (`EXPO_PUBLIC_THEME=system`); any other value, or none, is the dark identity. */
export const followsSystemTheme = (raw: string | undefined = process.env.EXPO_PUBLIC_THEME): boolean => raw === 'system';

/** The dark identity palette, or, in a build with `EXPO_PUBLIC_THEME=system`, the palette of the system scheme (light unless the system is dark). */
export function useTheme(): Palette {
  const scheme = useColorScheme();
  return followsSystemTheme() ? (scheme === 'dark' ? dark : light) : dark;
}
