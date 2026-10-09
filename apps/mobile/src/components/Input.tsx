import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { useFontFamily } from '../theme/fonts';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** Text input: 4px radius, 1px outline, 2px focus ring, in the body font. Callers pass layout (width, flex) in `style`. */
export function Input({ style, onFocus, onBlur, ...rest }: TextInputProps) {
  const c = useTheme();
  const family = useFontFamily();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={c.muted}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.input,
        { color: c.ink, backgroundColor: c.field, borderColor: focused ? c.focus : c.outline, fontFamily: family('400') },
        // A 2px ring replaces the 1px border; take the extra pixel from the padding so nothing moves.
        focused ? styles.focused : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 48, fontSize: 16 },
  focused: { borderWidth: 2, paddingHorizontal: 11 },
});
