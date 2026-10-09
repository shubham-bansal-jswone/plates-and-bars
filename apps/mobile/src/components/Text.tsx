import { StyleSheet, Text as RNText, type TextProps } from 'react-native';
import { useFontFamily } from '../theme/fonts';

/**
 * react-native's Text in the app fonts. Custom fonts have one family per weight, so the family is chosen from
 * the style's fontWeight and the weight itself is reset (otherwise the platform would synthesise bold on top).
 * Until the fonts load it is the plain system font.
 */
export function Text({ style, ...rest }: TextProps) {
  const family = useFontFamily();
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = family(flat.fontWeight);
  return <RNText {...rest} style={fontFamily ? [flat, { fontFamily, fontWeight: 'normal' }] : flat} />;
}
