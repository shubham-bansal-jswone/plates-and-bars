import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

/** Palette for the current system colour scheme (light unless the system is dark). */
export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
