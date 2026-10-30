import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

/** The palette of the system colour scheme: dark when the system is dark, light otherwise (including no preference). */
export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
