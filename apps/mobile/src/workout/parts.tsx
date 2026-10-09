import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Button, Hint } from '../components/ui';
import { pressedShadow, radius, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { catalog } from './catalog';

/** A toggle chip (prototype `.chip` with `aria-pressed`). */
/** `label` is the spoken name; `text` (default the label) is what shows. */
export function Chip({ label, text, pressed, onPress }: { label: string; text?: string; pressed?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={pressed === undefined ? undefined : { selected: pressed }}
      aria-pressed={pressed}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[styles.chip, { backgroundColor: pressed ? c.brand : c.surfaceSoft }]}
    >
      <Text style={{ color: pressed ? c.onBrand : c.ink, ...type.buttonSm }}>{text ?? label}</Text>
    </Pressable>
  );
}

/** The short message at the bottom of the screen (prototype `toast`). */
export function ToastBar({ message }: { message: string | null }) {
  const c = useTheme();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.toastWrap}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: c.toastBg, color: c.toastFg, shadowColor: c.shadow, ...pressedShadow }]}>
        {message}
      </Text>
    </View>
  );
}

export interface RestState {
  /** Changes with every new rest, so the timer restarts. */
  id: number;
  end: number;
  total: number;
  label: string;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Rest timer bar (prototype `#restbar`): counts down, +30 s, skip. */
export function RestBar({ rest, onAdd, onSkip }: { rest: RestState | null; onAdd: () => void; onSkip: () => void }) {
  // Mounted per rest, so the clock starts fresh each time a set is ticked.
  return rest ? <RunningRest key={rest.id} rest={rest} onAdd={onAdd} onSkip={onSkip} /> : null;
}

function RunningRest({ rest, onAdd, onSkip }: { rest: RestState; onAdd: () => void; onSkip: () => void }) {
  const c = useTheme();
  const [nowMs, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.round((rest.end - nowMs) / 1000));
  const pct = Math.min(100, (1 - left / rest.total) * 100);
  return (
    // The outer layer is opaque and runs to the screen edge, so the page behind never shows through the gap around the panel.
    <View style={[styles.restDock, { backgroundColor: c.bg }]}>
      <View accessibilityLabel="Rest timer" style={[styles.rest, { backgroundColor: c.surface, borderColor: c.line }]}>
        <View style={styles.restRow}>
          <View style={{ flexShrink: 1 }}>
            {/* Announced at start (the label line) and at the end only, not every second. */}
            <Text accessibilityLiveRegion={left ? 'none' : 'polite'} style={{ color: c.ink, fontWeight: '700', fontSize: 16 }}>
              {left ? `Rest ${mmss(left)}` : 'Rest done, go!'}
            </Text>
            <Text accessibilityLiveRegion="polite" style={{ color: c.muted, fontSize: 14 }}>{rest.label}</Text>
          </View>
          <View style={styles.restBtns}>
            <Button label="+30 s" kind="ghost" onPress={onAdd} />
            <Button label={left ? 'Skip' : 'Close'} kind="ghost" onPress={onSkip} />
          </View>
        </View>
        <View style={[styles.track, { backgroundColor: c.track }]}>
          <View accessibilityLabel={`Rest ${Math.round(pct)}% done`} style={[styles.fill, { backgroundColor: c.brand, width: `${pct}%` }]} />
        </View>
      </View>
    </View>
  );
}

function H({ children }: { children: string }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '700', fontSize: 16, marginTop: 10 }}>
      {children}
    </Text>
  );
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {items.map((x, i) => (
        <Text key={x} style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>
          {ordered ? `${i + 1}. ` : '• '}
          {x}
        </Text>
      ))}
    </View>
  );
}

/** The exercise how-to card sheet (prototype `openHowTo`), read from content `cards` (long keys). */
export function HowToSheet({ name, onClose }: { name: string | null; onClose: () => void }) {
  const c = useTheme();
  if (!name) return null;
  const card = catalog.cards[name];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent={false}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.sheetBody}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
            {name}
          </Text>
          {card ? (
            <>
              <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>
                <Text style={{ fontWeight: '700' }}>Where you should feel it: </Text>
                {card.where_to_feel}
              </Text>
              <H>Setup</H>
              <List items={card.setup} ordered />
              <H>3 key cues</H>
              <List items={card.key_cues} />
              <H>Common mistakes</H>
              <List items={card.common_mistakes} />
              {card.breathing ? (
                <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21, marginTop: 10 }}>
                  <Text style={{ fontWeight: '700' }}>Breathing: </Text>
                  {card.breathing}
                </Text>
              ) : null}
              {card.easier_version || card.harder_version ? (
                <Hint>
                  {card.easier_version ? `Easier version: ${card.easier_version}. ` : ''}
                  {card.harder_version ? `Harder version: ${card.harder_version}.` : ''}
                </Hint>
              ) : null}
            </>
          ) : (
            <Hint>No written guide for this exercise yet. Watch a couple of form videos, start light, and use the ramp to find your weight.</Hint>
          )}
          <Hint>Sharp or joint pain means stop, not push through. Muscle burn and effort are normal.</Hint>
          <Button label="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: radius.full, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 90, alignItems: 'center' },
  toast: { ...type.textBody, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, maxWidth: 520 },
  restDock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, alignItems: 'center' },
  rest: { width: '100%', borderWidth: 1, borderRadius: radius.lg, padding: 10, gap: 8, maxWidth: 560 },
  restRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  restBtns: { flexDirection: 'row', gap: 8 },
  track: { height: 6, borderRadius: radius.full, overflow: 'hidden' },
  fill: { height: 6 },
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  sheetBody: { width: '100%', maxWidth: 560, gap: 8 },
});
