import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { dateLabel, dateSub, type ViewedDate } from '../state/ViewedDate';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';
import { Press } from './ui';

/**
 * Says the new day once each time it changes (not on the first show). Mount it once per screen, outside whatever the screen swaps
 * while a day loads, so it is not remounted. Android and web read the polite live region, which is mounted empty and filled on a change
 * (as the rest timer's is); iOS has no live regions, so it is told with an announcement instead, and only by the focused screen (the tabs stay
 * mounted, so every one would otherwise announce the same change).
 */
export function DateAnnouncer({ v }: { v: ViewedDate }) {
  const text = `${dateLabel(v.date, v.today)}, ${dateSub(v.date)}`;
  // Filled in the render that sees a new day (not in an effect), so the live region changes after it mounted.
  const [seen, setSeen] = useState(text);
  const [said, setSaid] = useState('');
  if (seen !== text) {
    setSeen(text);
    setSaid(text);
  }
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
    };
  }, []));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else if (Platform.OS === 'ios' && focused.current) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  return <Text testID="date-announce" accessibilityLiveRegion="polite" style={styles.srOnly}>{Platform.OS === 'ios' ? '' : said}</Text>;
}

/** Previous day, the day shown, next day (off at today). Pair it with one DateAnnouncer. */
export function DateBar({ v }: { v: ViewedDate }) {
  const c = useTheme();
  const label = dateLabel(v.date, v.today);
  const sub = dateSub(v.date);
  return (
    <View style={styles.row} accessibilityRole="toolbar">
      <Press accessibilityRole="button" accessibilityLabel="Previous day" onPress={v.prev} style={styles.btn}>
        <Text style={{ color: c.ink, fontSize: 22 }}>‹</Text>
      </Press>
      <View style={styles.mid} accessible accessibilityLabel={`${label}, ${sub}`}>
        <Text style={{ color: c.ink, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: c.muted, fontSize: 13 }}>{sub}</Text>
      </View>
      <Press accessibilityRole="button" accessibilityLabel="Next day" disabled={v.isToday} onPress={v.next} style={[styles.btn, v.isToday && { opacity: 0.3 }]}>
        <Text style={{ color: c.ink, fontSize: 22 }}>›</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, marginTop: 4 },
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  srOnly: { position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' },
  mid: { minWidth: 120, alignItems: 'center' },
});
