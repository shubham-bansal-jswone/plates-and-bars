import { createContext, useContext, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useFonts } from 'expo-font';
// Per-weight entry points: the package root would bundle every weight (about 40 font files).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Roboto_300Light } from '@expo-google-fonts/roboto/300Light';
import type { FontWeight } from './tokens';

// Bundled with the app (no CDN request). Roboto is the display face, Inter is body and UI.
const FAMILY: Record<FontWeight, string> = {
  '300': 'Roboto_300Light',
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
};
const WEB_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

const FontsReady = createContext(false);

/** Loads the fonts in the background. Children render at once in the system font and switch when loaded. */
export function FontsProvider({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Roboto_300Light });
  return <FontsReady.Provider value={loaded && !error}>{children}</FontsReady.Provider>;
}

/** Normalises a style's fontWeight (named, numeric or missing) to one of the weights we ship. */
export function toWeight(w: unknown): FontWeight {
  const n = w === 'bold' ? 700 : w === 'normal' || w === undefined ? 400 : Number(w);
  if (n <= 300) return '300';
  if (n <= 400) return '400';
  if (n <= 500) return '500';
  if (n <= 600) return '600';
  return '700';
}

/** fontFamily for a weight, or undefined (system font) until the fonts have loaded. */
export function useFontFamily(): (weight?: unknown) => string | undefined {
  const ready = useContext(FontsReady);
  return (weight) => {
    if (!ready) return undefined;
    const f = FAMILY[toWeight(weight)];
    return Platform.OS === 'web' ? `${f}, ${WEB_FALLBACK}` : f;
  };
}
