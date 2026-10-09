import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch as RNSwitch, View, type SwitchProps, type TextInputProps, type ViewProps } from 'react-native';
import { useColorScheme } from 'react-native';
import { pressedShadow, radius, space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Input } from './Input';
import { Text } from './Text';

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
  a11yLabel,
  expanded,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'link';
  /** Spoken label when it needs more than the visible text. */
  a11yLabel?: string;
  /** For a button that shows or hides something: announces open or closed. */
  expanded?: boolean;
}) {
  const c = useTheme();
  const scheme = useColorScheme();
  const palette = {
    primary: { bg: c.brand, pressed: c.brandPressed, fg: c.onBrand, border: c.brand },
    ghost: { bg: 'transparent', pressed: c.surfaceSoft, fg: c.ink, border: scheme === 'dark' ? c.line : c.disabled },
    link: { bg: 'transparent', pressed: 'transparent', fg: c.link, border: 'transparent' },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        kind === 'link' ? styles.link : styles.btn,
        kind !== 'link' && { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border, borderWidth: 1 },
        pressed && kind !== 'link' && { shadowColor: c.shadow, ...pressedShadow },
      ]}
    >
      <Text style={[kind === 'link' ? type.bodyStrong : type.button, { color: palette.fg }]}>{label}</Text>
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
      hitSlop={chip ? { top: 6, bottom: 6 } : undefined}
      style={[
        chip ? styles.chip : styles.opt,
        chip
          ? { backgroundColor: selected ? c.brand : c.surfaceSoft }
          : { borderColor: selected ? c.brand : c.line, backgroundColor: selected ? c.tint : c.surface, borderWidth: selected ? 2 : 1 },
      ]}
    >
      <Text style={[chip ? type.buttonSm : type.bodyStrong, { color: chip && selected ? c.onBrand : c.ink }]}>{label}</Text>
      {sub ? <Text style={[type.caption, { color: c.body }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Field({ label, ...rest }: TextInputProps & { label: string }) {
  return <Input accessibilityLabel={label} style={styles.input} {...rest} />;
}

export function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      {children}
    </View>
  );
}

/** Flat card: `surface` fill, 8px radius, 16 padding, no border or shadow. */
export function Card({ style, ...rest }: ViewProps) {
  const c = useTheme();
  return <View {...rest} style={[styles.card, { backgroundColor: c.surface }, style]} />;
}

// react-native-web colours the on-state thumb with `activeThumbColor`; react-native's types do not list it.
const webThumb = (activeThumbColor: string): object => ({ activeThumbColor });

/** Switch with the off-state track kept visible (#153) and a white thumb on web too. */
export function Switch(props: SwitchProps) {
  const c = useTheme();
  return <RNSwitch trackColor={{ true: c.brand, false: c.muted }} thumbColor={c.onBrand} {...webThumb(c.onBrand)} {...props} />;
}

export const layout = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  field: { gap: 8, marginTop: 16 },
});

const styles = StyleSheet.create({
  page: { padding: space.lg, alignItems: 'center', flexGrow: 1 },
  column: { width: '100%', maxWidth: 560, gap: space.sm },
  h1: { ...type.title, marginTop: space.sm },
  hint: { ...type.caption },
  label: { ...type.label },
  note: { ...type.caption, padding: space.md, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  btn: { minHeight: 48, borderRadius: radius.full, paddingHorizontal: space.xl, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  link: { minHeight: 44, paddingHorizontal: space.xs, alignSelf: 'flex-start', justifyContent: 'center' },
  card: { borderRadius: radius.md, padding: space.lg, gap: space.sm },
  group: { gap: space.sm },
  opt: { borderRadius: radius.md, padding: 14, gap: 2, minHeight: 48 },
  chip: { borderRadius: radius.full, paddingHorizontal: space.md, minHeight: 32, justifyContent: 'center' },
  input: { minWidth: 90, flexGrow: 1, maxWidth: 160 },
});
