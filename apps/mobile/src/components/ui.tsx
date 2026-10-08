import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/useTheme';

/** Scrolling page with a centred column: full width on a phone, a readable column on desktop. */
export function Page({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>{children}</View>
    </ScrollView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.h1, { color: c.ink }]}>
      {children}
    </Text>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.hint, { color: c.muted }]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.label, { color: c.ink }]}>{children}</Text>;
}

export function Note({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.note, { color: c.ink, backgroundColor: c.tint, borderColor: c.line }]}>{children}</Text>;
}

export function ErrorText({ children }: { children: string }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="alert" style={[styles.hint, { color: c.danger }]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'link';
}) {
  const c = useTheme();
  const bg = kind === 'primary' ? c.brand : 'transparent';
  const fg = kind === 'primary' ? c.onBrand : c.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.btn, kind === 'link' ? styles.link : { backgroundColor: bg, borderColor: c.brand, borderWidth: 1 }]}
    >
      <Text style={{ color: fg, fontWeight: kind === 'link' ? '600' : '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

/** A selectable answer: a big option (label plus a line of detail) or a small chip. */
export function Choice({
  label,
  sub,
  selected,
  onPress,
  chip,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  chip?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={[
        chip ? styles.chip : styles.opt,
        { borderColor: selected ? c.brand : c.line, backgroundColor: selected ? c.tint : c.surface, borderWidth: selected ? 2 : 1 },
      ]}
    >
      <Text style={{ color: c.ink, fontWeight: '600', fontSize: 16 }}>{label}</Text>
      {sub ? <Text style={{ color: c.muted, fontSize: 14 }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Field({ label, ...rest }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={c.muted}
      style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
      {...rest}
    />
  );
}

export function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      {children}
    </View>
  );
}

export const layout = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  field: { gap: 8, marginTop: 16 },
});

const styles = StyleSheet.create({
  page: { padding: 16, alignItems: 'center', flexGrow: 1 },
  column: { width: '100%', maxWidth: 560, gap: 8 },
  h1: { fontSize: 26, fontWeight: '800', lineHeight: 32, marginTop: 8 },
  hint: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 16, fontWeight: '700' },
  note: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  link: { minHeight: 44, paddingHorizontal: 4, alignSelf: 'flex-start' },
  group: { gap: 8 },
  opt: { borderRadius: 12, padding: 14, gap: 2, minHeight: 48 },
  chip: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, fontSize: 16, minWidth: 90, flexGrow: 1, maxWidth: 160 },
});
