import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch as RNSwitch, useWindowDimensions, View, type PressableProps, type SwitchProps, type TextInputProps, type TextProps, type ViewProps } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { dark, glowShadow, pressedShadow, radius, space, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { useBottomInset } from './bottomInset';
import { Input } from './Input';
import { Text } from './Text';

const ScrollTop = createContext<() => void>(() => {});

/**
 * Scrolling page with a centred column: full width on a phone, a readable column on desktop.
 * The ScrollView is reused when the content under it changes, so the offset carries over (#1060); a child that swaps its
 * content in place passes `resetKey` (the page itself) or calls `useScrollToTopOn` (a child) to start the new content at the top.
 */
export function Page({ children, resetKey, wide }: { children: ReactNode; resetKey?: unknown; /** Let the column grow to 1040px on a wide screen (>= 900px) for a two-column card layout; forms leave it off. */ wide?: boolean }) {
  const c = useTheme();
  const isWide = useWide();
  const bottom = useBottomInset();
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const toTop = useCallback(() => ref.current?.scrollTo({ x: 0, y: 0, animated: false }), []);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) first.current = false;
    else toTop();
  }, [resetKey, toTop]);
  return (
    <ScrollView ref={ref} style={{ backgroundColor: c.bg }} contentContainerStyle={[styles.page, { paddingBottom: space.lg + bottom }]} keyboardShouldPersistTaps="handled">
      <ScrollTop.Provider value={toTop}>
        <View role="main" style={[styles.column, wide && isWide ? styles.columnWide : null]}>{children}</View>
      </ScrollTop.Provider>
    </ScrollView>
  );
}

/** True on a screen at least 900px wide: the width where `Page` lets a `wide` screen lay its cards out in two columns. */
export function useWide(): boolean {
  return useWindowDimensions().width >= 900;
}

/** Scrolls the enclosing `Page` back to the top whenever `key` changes (not on first render). */
export function useScrollToTopOn(key: unknown) {
  const toTop = useContext(ScrollTop);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) first.current = false;
    else toTop();
  }, [key, toTop]);
}

/** Heading levels: the screen title is 1, section and card titles are 2, titles inside a section are 3. */
export type HeadingLevel = 1 | 2 | 3;

/**
 * A heading at an explicit level. react-native-web renders `accessibilityRole="header"` as `<h1 role="heading">` and an
 * explicit role without `aria-level` counts as level 2, so the level is always passed (#382). Native ignores it.
 */
export function Heading({ level, style, children }: { level: HeadingLevel; style?: TextProps['style']; children: ReactNode }) {
  return (
    <Text accessibilityRole="header" aria-level={level} style={style}>
      {children}
    </Text>
  );
}

/** The screen title style. Level 1 is the screen title, exactly one per screen; 2 only for a second title-sized heading below it. */
export function H1({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 }) {
  const c = useTheme();
  return (
    <Heading level={level} style={[styles.h1, { color: c.ink }]}>
      {children}
    </Heading>
  );
}

/**
 * The accessibility state of a control, once. `accessibilityState` is what native reads; react-native-web ignores it and
 * only emits the `aria-*` props, so every stateful control spreads this (#381). `pressed` is a toggle button
 * (`aria-pressed`, spoken on native as selected).
 */
export function a11yState(s: { selected?: boolean; checked?: boolean; expanded?: boolean; busy?: boolean; pressed?: boolean }) {
  const defined = Object.entries(s).filter(([, v]) => v !== undefined);
  const { pressed, ...native } = Object.fromEntries(defined) as typeof s;
  return {
    accessibilityState: defined.length ? { ...native, ...(pressed === undefined ? null : { selected: pressed }) } : undefined,
    'aria-selected': s.selected,
    'aria-checked': s.checked,
    'aria-expanded': s.expanded,
    'aria-busy': s.busy,
    'aria-pressed': s.pressed,
  };
}

export function Hint({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.hint, { color: c.muted }]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.label, { color: c.ink }]}>{children}</Text>;
}

/**
 * A visible caption over a Field that already carries the same spoken label. It is hidden from screen readers so
 * the label is not read twice. `aria-hidden` is required, not optional: react-native-web 0.21 ignores
 * accessibilityElementsHidden and importantForAccessibility, so only aria-hidden hides it on web (RN maps it to the native props).
 */
export function Caption({ children }: { children: ReactNode }) {
  return <View aria-hidden><Label>{children}</Label></View>;
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

/** The surface a control sits on decides its ring colour: the theme's focus colour on canvas, surface and tint; `link-dark` on a dark surface; white on a brand fill. */
export type RingSurface = 'canvas' | 'dark' | 'brand';

/** Focus ring for keyboard and switch-access focus: 2px, 2px offset. On web, mouse clicks do not show it (`:focus-visible`). */
export function useFocusRing(surface: RingSurface = 'canvas') {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const color = surface === 'brand' ? c.onBrand : surface === 'dark' ? dark.focus : c.focus;
  return {
    ring: focused ? ({ outlineWidth: 2, outlineOffset: 2, outlineStyle: 'solid', outlineColor: color } as const) : null,
    onFocus: (e: { target: unknown }) => {
      const t = e.target as { matches?: (selector: string) => boolean };
      setFocused(typeof t.matches === 'function' ? t.matches(':focus-visible') : true);
    },
    onBlur: () => setFocused(false),
  };
}

/** Pressable with the focus ring. Every tappable control uses this, so none can miss the ring. */
export function Press({ surface, style, onFocus, onBlur, ...rest }: PressableProps & { surface?: RingSurface; ref?: Ref<ComponentRef<typeof View>> }) {
  const f = useFocusRing(surface);
  return (
    <Pressable
      {...rest}
      onFocus={(e) => {
        f.onFocus(e);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        f.onBlur();
        onBlur?.(e);
      }}
      style={(state) => [typeof style === 'function' ? style(state) : style, f.ring]}
    />
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  a11yLabel,
  expanded,
  busy,
  surface,
  disabled,
}: {
  label: string;
  onPress: () => void;
  /** Not pressable and drawn faded; announced as disabled. */
  disabled?: boolean;
  kind?: 'primary' | 'ghost' | 'link';
  /** Spoken label when it needs more than the visible text. */
  a11yLabel?: string;
  /** For a button that shows or hides something: announces open or closed. */
  expanded?: boolean;
  /** A request is running: announces busy. */
  busy?: boolean;
  /** Surface the button sits on, when not the plain page: picks the focus ring colour. */
  surface?: RingSurface;
}) {
  const c = useTheme();
  const palette = {
    primary: { bg: c.brand, pressed: c.brandPressed, fg: c.onBrand, border: c.brand },
    ghost: { bg: 'transparent', pressed: c.surfaceSoft, fg: c.ink, border: c.ghostBorder },
    link: { bg: 'transparent', pressed: 'transparent', fg: c.link, border: 'transparent' },
  }[kind];
  return (
    <Press
      surface={surface}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      {...a11yState({ expanded, busy: busy || undefined })}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        kind === 'link' ? styles.link : styles.btn,
        disabled && { opacity: 0.45 },
        kind !== 'link' && { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border, borderWidth: 1 },
        pressed && kind !== 'link' && { shadowColor: c.shadow, ...pressedShadow },
        // The one glow of the identity: the primary action, at rest. Light's glow is white, so it draws nothing there.
        kind === 'primary' && !disabled && !pressed && { shadowColor: c.glow, ...glowShadow },
      ]}
    >
      <Text style={[kind === 'link' ? type.bodyStrong : type.button, { color: palette.fg }]}>{label}</Text>
    </Press>
  );
}

/** A selectable answer: a big option (label plus a line of detail) or a small chip. */
export function Choice({
  label,
  sub,
  selected,
  onPress,
  chip,
  action,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  chip?: boolean;
  /** An answer that acts at once (a button), not a choice kept until Continue (a radio). */
  action?: boolean;
}) {
  const c = useTheme();
  return (
    <Press
      accessibilityRole={action ? 'button' : 'radio'}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      // A radio must announce its state on web too (WCAG 4.1.2).
      {...a11yState(action ? {} : { checked: selected })}
      onPress={onPress}
      hitSlop={chip ? { top: 2, bottom: 2 } : undefined}
      style={[
        chip ? styles.chip : styles.opt,
        chip
          ? { backgroundColor: selected ? c.brand : c.surfaceSoft }
          : { borderColor: selected ? c.brand : c.line, backgroundColor: selected ? c.tint : c.surface, borderWidth: selected ? 2 : 1 },
      ]}
    >
      <Text style={[chip ? type.buttonSm : type.bodyStrong, { color: chip && selected ? c.onBrand : c.ink }]}>{label}</Text>
      {sub ? <Text style={[type.caption, { color: c.body }]}>{sub}</Text> : null}
    </Press>
  );
}

/**
 * A toggle chip: filter, rating and quick-answer buttons. `label` is the spoken name, `text` (default the label) what shows.
 * Selected = lime fill with dark text. One component for the whole app.
 */
export function Chip({ label, text, pressed, danger, onPress }: { label: string; text?: string; pressed?: boolean; danger?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      {...a11yState({ pressed })}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      style={[styles.chip, { backgroundColor: pressed ? c.brand : c.surfaceSoft }, danger ? { borderWidth: 1, borderColor: c.danger } : null]}
    >
      <Text style={[type.buttonSm, { color: pressed ? c.onBrand : danger ? c.danger : c.ink }]}>{text ?? label}</Text>
    </Press>
  );
}

export function Field({ label, invalid, style, ...rest }: TextInputProps & { label: string; /** The value is wrong: announces `aria-invalid` and draws a danger border (after the caller's style, so it wins). */ invalid?: boolean }) {
  const c = useTheme();
  return <Input accessibilityLabel={label} aria-invalid={invalid || undefined} {...rest} style={[styles.input, style, invalid ? { borderColor: c.danger } : null]} />;
}

export function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      {children}
    </View>
  );
}

/** Flat card: `surface` fill, 20px radius, 16 padding, no border or shadow. */
export function Card({ style, ...rest }: ViewProps) {
  const c = useTheme();
  return <View {...rest} style={[styles.card, { backgroundColor: c.surface }, style]} />;
}

// react-native-web colours the on-state thumb with `activeThumbColor`; react-native's types do not list it.
const webThumb = (activeThumbColor: string): object => ({ activeThumbColor });

// The switch itself reports focus (react-native-web passes these to the native input); the ring is drawn on the wrapper.
const focusHandlers = (f: ReturnType<typeof useFocusRing>, props: object): object => {
  const p = props as { onFocus?: (e: { target: unknown }) => void; onBlur?: () => void };
  return {
    onFocus: (e: { target: unknown }) => {
      f.onFocus(e);
      p.onFocus?.(e);
    },
    onBlur: () => {
      f.onBlur();
      p.onBlur?.();
    },
  };
};

/** Switch with the off-state track kept visible (#153) and a white thumb on web too. */
export function Switch(props: SwitchProps) {
  const c = useTheme();
  const f = useFocusRing();
  return (
    // The 44x44 hit area is a sibling Pressable behind the unchanged 40x20 track, so clicks on the switch never reach it (#1121).
    // Not an a11y node or tab stop: the switch carries the role, label and state.
    <View style={styles.switchHit}>
      <Pressable
        testID="switch-hit-area"
        accessible={false}
        focusable={false}
        importantForAccessibility="no"
        disabled={props.disabled ?? false}
        onPress={() => props.onValueChange?.(!props.value)}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.switchRing, f.ring]}>
        <RNSwitch
          trackColor={{ true: c.brand, false: c.muted }}
          thumbColor={props.value ? c.onBrand : c.ink}
          {...webThumb(c.onBrand)}
          {...props}
          {...focusHandlers(f, props)}
        />
      </View>
    </View>
  );
}

export const layout = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  field: { gap: 8, marginTop: 16 },
});

const styles = StyleSheet.create({
  page: { padding: space.lg, alignItems: 'center', flexGrow: 1 },
  column: { width: '100%', maxWidth: 560, gap: space.sm },
  columnWide: { maxWidth: 1040 },
  h1: { ...type.title, marginTop: space.sm },
  hint: { ...type.caption },
  label: { ...type.label },
  note: { ...type.caption, padding: space.md, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  btn: { minHeight: 52, borderRadius: radius.full, paddingHorizontal: space.xl, alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  link: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  group: { gap: space.sm },
  opt: { borderRadius: radius.lg, padding: 16, gap: 2, minHeight: 56 },
  chip: { borderRadius: radius.full, paddingHorizontal: space.lg, minHeight: 44, justifyContent: 'center' },
  switchHit: { minWidth: 44, minHeight: 44, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  switchRing: { alignSelf: 'flex-start', borderRadius: radius.full },
  input: { minWidth: 90, flexGrow: 1, maxWidth: 160 },
});

function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20" aria-hidden style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
      <Path d="M7 4l6 6-6 6" stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * A 56px row that shows or hides its children (`aria-expanded`). `defaultOpen` sets the first state; pass `open` to control it.
 * Children are not mounted while closed.
 */
export function Disclosure({ label, defaultOpen = false, open: controlled, onOpenChange, a11yLabel, children }: { label: string; defaultOpen?: boolean; /** Controlled: the parent holds the state (so it can open the row itself). */ open?: boolean; onOpenChange?: (open: boolean) => void; a11yLabel?: string; children: ReactNode }) {
  const c = useTheme();
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const setOpen = (o: boolean) => {
    setOwn(o);
    onOpenChange?.(o);
  };
  return (
    <View style={{ gap: space.sm }}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={a11yLabel ?? label}
        {...a11yState({ expanded: open })}
        onPress={() => setOpen(!open)}
        style={[extra.disclosure, { borderColor: c.line }]}
      >
        <Text style={[type.bodyStrong, { color: c.muted, flex: 1 }]}>{label}</Text>
        <Chevron open={open} color={c.muted} />
      </Press>
      {open ? children : null}
    </View>
  );
}

/** A row of up to 3 figures with 1px dividers between them, each cell at least 56px tall. `small` is muted text after the value (e.g. " / 6"); `lime` draws the value in the brand colour when it is a real, non-zero number (set on one cell per screen). Spoken as "label: value". */
export function MetricRow({ cells }: { cells: readonly { label: string; value: string; small?: string; lime?: boolean }[] }) {
  const c = useTheme();
  return (
    <View style={extra.metricRow}>
      {cells.map((m, i) => (
        <View key={m.label} accessible accessibilityLabel={`${m.label}: ${m.value}${m.small ?? ''}`} style={[extra.metricCell, i > 0 && { borderLeftWidth: 1, borderLeftColor: c.line }]}>
          <Text style={[type.metricSm, tabular, { color: m.lime && m.value !== '–' && m.value !== '0' ? c.brand : c.ink }]}>
            {m.value}
            {m.small ? <Text style={[type.small, { color: c.muted }]}>{m.small}</Text> : null}
          </Text>
          <Text style={[type.small, { color: c.muted, textAlign: 'center' }]}>{m.label}</Text>
        </View>
      ))}
    </View>
  );
}

const extra = StyleSheet.create({
  disclosure: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderTopWidth: 1 },
  metricRow: { flexDirection: 'row' },
  metricCell: { flex: 1, minHeight: 56, paddingHorizontal: space.sm, justifyContent: 'center', alignItems: 'center' },
});
