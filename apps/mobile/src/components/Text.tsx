import { StyleSheet, Text as RNText, type TextProps } from 'react-native';
import { useFontFamily, useFontsReady } from '../theme/fonts';

/**
 * react-native's Text in the app fonts. Custom fonts have one family per weight, so the family is chosen from
 * the style's fontWeight and the weight itself is reset (otherwise the platform would synthesise bold on top).
 * Until the fonts load it is the plain system font.
 */
export function Text({ style, ...rest }: TextProps) {
  const family = useFontFamily();
  const ready = useFontsReady();
  const flat = StyleSheet.flatten(style) ?? {};
  // Only once loaded: the bundled fonts are one family per weight, so only then can fontWeight be reset; before that the style's own weight must stay.
  const fontFamily = ready ? family(flat.fontWeight, flat.fontStyle) : undefined;
  return <RNText {...rest} style={fontFamily ? [flat, { fontFamily, fontWeight: 'normal', ...(flat.fontStyle === 'italic' ? { fontStyle: 'normal' as const } : null) }] : flat} />;
}
