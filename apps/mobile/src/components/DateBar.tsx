import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { addDays } from '@plate-and-bar/core';
import type { ViewedDate } from '../state/ViewedDate';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';
import { Press } from './ui';

const parse = (d: string): Date => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, day);
};

/** The prototype's header label: Today, Yesterday, else the short weekday. */
export const dateLabel = (date: string, today: string): string =>
  date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : parse(date).toLocaleDateString('en-IN', { weekday: 'short' });
/** The line under it: "Saturday, 17 Oct". */
export const dateSub = (date: string): string => parse(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

/** Previous day, the day shown, next day (off at today). The label is announced when the day changes. */
export function DateBar({ v }: { v: ViewedDate }) {
  const c = useTheme();
  const label = dateLabel(v.date, v.today);
  const sub = dateSub(v.date);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else AccessibilityInfo.announceForAccessibility(`${label}, ${sub}`);
  }, [v.date, label, sub]);
  return (
    <View style={styles.row} accessibilityRole="toolbar">
      <Press accessibilityRole="button" accessibilityLabel="Previous day" onPress={v.prev} style={styles.btn}>
        <Text style={{ color: c.ink, fontSize: 22 }}>‹</Text>
      </Press>
      <View style={styles.mid} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${label}, ${sub}`}>
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
  mid: { minWidth: 120, alignItems: 'center' },
});
