import { useEffect, useRef, useState } from 'react';
import { SheetModal } from '../components/Sheet';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../components/Text';
import { Heading, Button, Hint, Press } from '../components/ui';
import { pressedShadow, radius, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { buzz, restDoneBuzz } from '../haptics';
import { BodyMap } from './BodyMap';
import { ExerciseFigure } from './ExerciseFigure';
import { getCatalog } from './catalog';
import { musclesOf } from './muscles';
import { Ring } from './Ring';
import { VideoLink } from './VideoLink';

/** The short message (prototype `toast`), at the bottom of the screen, or at the top edge with `top` (the Workout tab's set-row refusal, which at the bottom would cover the row and tick). */
/** `lift` raises a bottom toast by that many px (the Workout tab lifts it above the rest dock, which would otherwise cover it); a top toast ignores it. */
export function ToastBar({ message, lift = 0, top = false }: { message: string | null; lift?: number; top?: boolean }) {
  const c = useTheme();
  // iOS has no live regions, so it is told each time the toast text changes; Android and web read the polite live region below.
  useEffect(() => {
    if (message && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toastWrap, top ? styles.toastTop : [styles.toastBottom, lift ? { bottom: 90 + lift } : null]]}>
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
  /** Exercise names in order from the one just ticked onward (ungrouped sessions). The label names the first still having an undone set (never an earlier exercise); the rest is cleared when none has. */
  from?: string[];
  /** The exercise whose set was ticked (position and name at that time). A grouped session's rest has `at` and `to` (and no `from`): its dock follows the session by position. */
  at?: { i: number; name: string };
  /** The set the label names (position and exercise name at that time). */
  to?: { ex: number; set: number; name: string };
  /** The day the rest started on. */
  date?: string;
}

/** A grouped rest's target as `restTarget` returns it. */
export type GroupNext = Required<Pick<RestState, 'at' | 'to' | 'label'>>;
/** What `startRest` takes: an ungrouped session's label with its names list, or a grouped session's target. */
export type RestNext = Pick<RestState, 'label' | 'from' | 'at' | 'to'>;

const REST_DONE = 'Rest done, go!';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The rest dock's height until it has been laid out once (default text size is about 133). The dock grows with text size, so the screen uses the measured height (`onHeight`) once it has one. */
export const DOCK_FALLBACK_H = 150;
/** Space the page keeps under its last control, past the dock's own height. */
export const DOCK_SPACER_MARGIN = 34;

/** Rest timer bar (prototype `#restbar`): counts down, +30 s, skip. `onHeight` gets the dock's height, and the rest's id, each time it is laid out. */
export function RestBar({ rest, onAdd, onSkip, onHeight }: { rest: RestState | null; onAdd: () => void; onSkip: () => void; onHeight?: (h: number, restId: number) => void }) {
  // Mounted per rest, so the clock starts fresh each time a set is ticked.
  return rest ? <RunningRest key={rest.id} rest={rest} onAdd={onAdd} onSkip={onSkip} {...(onHeight ? { onHeight } : {})} /> : null;
}

function RunningRest({ rest, onAdd, onSkip, onHeight }: { rest: RestState; onAdd: () => void; onSkip: () => void; onHeight?: (h: number, restId: number) => void }) {
  const c = useTheme();
  const [nowMs, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.round((rest.end - nowMs) / 1000));
  // iOS has no live regions (and skips the transparent text below), so it is told once each time the timer ends, and keeps the visible text.
  const ended = left === 0;
  useEffect(() => {
    if (ended && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(REST_DONE);
  }, [ended]);
  // One buzz per rest end. "+30 s" moves the end and re-arms it, as the prototype's `REST.buzzed = false`.
  const buzzedEnd = useRef<number | null>(null);
  useEffect(() => {
    if (ended && buzzedEnd.current !== rest.end) {
      buzzedEnd.current = rest.end;
      buzz(restDoneBuzz());
    }
  }, [ended, rest.end]);
  const pct = Math.min(100, (1 - left / rest.total) * 100);
  const time = mmss(left);
  return (
    // The dock is opaque and runs to the screen edge, so the page behind never shows through; on wide screens its panel stays a 560 px column in the middle.
    <View onLayout={(e) => onHeight?.(e.nativeEvent.layout.height, rest.id)} style={[styles.restDock, { backgroundColor: c.bg, borderColor: c.line, borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }]}>
      <View accessibilityLabel="Rest timer" style={styles.rest}>
        <Ring progress={pct / 100} label={`Rest ${Math.round(pct)}% done`}>
          {/* At zero on Android and web the visible "Rest done, go!" is hidden from assistive tech: the live region below says it,
              so a swipe through the bar does not read it twice. On iOS the live region does not speak and its transparent text is
              skipped, so the visible text stays readable there. While counting, the text stays readable everywhere. */}
          <Text
            testID="rest-title"
            maxFontSizeMultiplier={1.5}
            accessibilityLabel={left ? `Rest ${time}` : REST_DONE}
            aria-hidden={ended && Platform.OS !== 'ios' ? true : undefined}
            style={[left ? (time.length > 4 ? type.metricSm : [type.metric, styles.count]) : styles.done, tabular, { color: c.ink, textAlign: 'center' }]}
          >
            {left ? time : REST_DONE}
          </Text>
        </Ring>
        <View style={styles.restSide}>
          {/* Screen readers only announce a live region whose text changes after it is mounted. This one is mounted empty with
              the bar and filled at zero, so "Rest done, go!" is spoken once and the countdown is not read every second.
              srOnly hides it visually only: no display: none and no aria-hidden, which would silence the region. */}
          <Text testID="rest-announce" accessibilityLiveRegion="polite" style={styles.srOnly}>{left ? '' : REST_DONE}</Text>
          <Text accessibilityLiveRegion="polite" style={[type.bodyStrong, { color: c.ink }]}>{rest.label}</Text>
          <View style={styles.restBtns}>
            <Button label="+30 s" kind="ghost" onPress={onAdd} />
            <Button label={left ? 'Skip' : 'Close'} kind={left ? 'ghost' : 'primary'} onPress={onSkip} />
          </View>
        </View>
      </View>
    </View>
  );
}

function H({ children }: { children: string }) {
  const c = useTheme();
  return (
    <Heading level={3} style={{ color: c.ink, fontWeight: '700', fontSize: 16, marginTop: 10 }}>
      {children}
    </Heading>
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
  const card = getCatalog().cards[name];
  const { primary, secondary } = musclesOf([name]);
  return (
    <SheetModal title={name} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.sheetBody}>
          {/* The title comes first in the DOM, where focus starts, so the close X is the next tab stop. */}
          <View style={styles.titleRow}>
            <Heading level={2} style={[type.heading, { color: c.ink, flex: 1 }]}>
              {name}
            </Heading>
            <Press accessibilityRole="button" accessibilityLabel={`Close ${name} guide`} onPress={onClose} style={styles.closeX}>
              <Svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
                <Path d="M5 5l14 14M19 5L5 19" stroke={c.ink} strokeWidth={2.5} strokeLinecap="round" />
              </Svg>
            </Press>
          </View>
          <ExerciseFigure name={name} />
          {card ? (
            <>
              {primary.length ? <BodyMap primary={primary} secondary={secondary} /> : null}
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
          <VideoLink name={name} />
          <Hint>Sharp or joint pain means stop, not push through. Muscle burn and effort are normal.</Hint>
          <Button label="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toastBottom: { bottom: 90 },
  toastTop: { top: 12 },
  toast: { ...type.textBody, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, maxWidth: 520 },
  srOnly: { position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' },
  restDock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, alignItems: 'center' },
  rest: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 16, maxWidth: 560, padding: 4 },
  restSide: { flex: 1, gap: 4 },
  // The 56 px metric size is wider than the ring holds for "2:30"; 34 sits inside the 100 px ring.
  count: { fontSize: 34, lineHeight: 38 },
  // 'Rest done, go!' wraps in short lines well inside the 100px ring (17px touched the stroke).
  done: { fontSize: 13, lineHeight: 17, fontWeight: '700', paddingHorizontal: 16 },
  restBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  sheetBody: { width: '100%', maxWidth: 560, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closeX: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
