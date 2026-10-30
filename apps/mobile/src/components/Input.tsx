import { useState } from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps } from 'react-native';
import type { ComponentRef, Ref } from 'react';
import { useFontFamily } from '../theme/fonts';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/** Text input: 10px radius, 1px outline, 2px focus ring, in the body font. Callers pass layout (width, flex) in `style`. */
export function Input({ style, invalid, onFocus, onBlur, ref, ...rest }: TextInputProps & { ref?: Ref<ComponentRef<typeof TextInput>>; /** The value is wrong: a danger border (after the caller's style, so it wins). While focused it also gets a 2px focus-colour outline on web, so the focus cue is not the danger border alone. */ invalid?: boolean }) {
  const c = useTheme();
  const family = useFontFamily();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={c.muted}
      {...rest}
      ref={ref}
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
        { color: c.ink, backgroundColor: c.field, borderColor: focused ? c.focus : c.outline, fontFamily: family('600') },
        // A 2px ring replaces the 1px border; take the extra pixel from the padding so nothing moves.
        focused ? styles.focused : null,
        style,
        invalid ? { borderColor: c.danger } : null,
        Platform.OS === 'web' ? (invalid && focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2, outlineColor: c.focus } as object : noBrowserOutline) : null,
      ]}
    />
  );
}

// Web: Chrome's own `outline: auto` would draw over the 2px ring; the ring (or the 1px border) is the only indicator.
const noBrowserOutline = { outlineStyle: 'none', outlineWidth: 0 } as object;

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 14, minHeight: 52, fontSize: 17 },
  focused: { borderWidth: 2, paddingHorizontal: 13 },
});
