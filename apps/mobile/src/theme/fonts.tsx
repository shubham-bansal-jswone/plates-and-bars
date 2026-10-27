import { createContext, useContext, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useFonts } from 'expo-font';
// Per-weight entry points: the package root would bundle every weight (about 40 font files).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';
import { Inter_900Black_Italic } from '@expo-google-fonts/inter/900Black_Italic';
import { Roboto_300Light } from '@expo-google-fonts/roboto/300Light';
import type { FontWeight } from './tokens';

// Bundled with the app (no CDN request). Inter carries everything: Black Italic is the hero face (display, metrics), ExtraBold the
// titles. Roboto Light stays loaded only for the light theme's older screens that still ask for weight 300.
const FAMILY: Record<FontWeight, string> = {
  '300': 'Roboto_300Light',
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
  '900': 'Inter_900Black',
};
/** Italic faces we ship: only Black. Italic at any other weight draws the upright face. */
const ITALIC_FAMILY: Partial<Record<FontWeight, string>> = { '900': 'Inter_900Black_Italic' };
const WEB_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

const FontsReady = createContext(false);

/** Loads the fonts in the background. Children render at once in the system font and switch when loaded. */
export function FontsProvider({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black, Inter_900Black_Italic, Roboto_300Light });
  return <FontsReady.Provider value={loaded && !error}>{children}</FontsReady.Provider>;
}

/** Normalises a style's fontWeight (named, numeric or missing) to one of the weights we ship. */
export function toWeight(w: unknown): FontWeight {
  const n = w === 'bold' ? 700 : w === 'normal' || w === undefined ? 400 : Number(w);
  if (n <= 300) return '300';
  if (n <= 400) return '400';
  if (n <= 500) return '500';
  if (n <= 600) return '600';
  if (n <= 700) return '700';
  if (n <= 800) return '800';
  return '900';
}

/** True once the bundled fonts have loaded (false while loading and if loading failed). */
export function useFontsReady(): boolean {
  return useContext(FontsReady);
}

/**
 * fontFamily for a weight. Until the fonts have loaded, or if loading failed, it is the fallback
 * stack on web (SVG text would otherwise fall back to the browser's serif) and undefined on native, where
 * undefined is the system font.
 */
export function useFontFamily(): (weight?: unknown, fontStyle?: unknown) => string | undefined {
  const ready = useContext(FontsReady);
  return (weight, fontStyle) => {
    const web = Platform.OS === 'web';
    if (!ready) return web ? WEB_FALLBACK : undefined;
    const w = toWeight(weight);
    const f = (fontStyle === 'italic' && ITALIC_FAMILY[w]) || FAMILY[w];
    return web ? `${f}, ${WEB_FALLBACK}` : f;
  };
}
