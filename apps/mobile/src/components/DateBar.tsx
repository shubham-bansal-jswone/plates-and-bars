import { StyleSheet, View } from 'react-native';
import { dateLabel, dateSub, type ViewedDate } from '../state/ViewedDate';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';
import { Press } from './ui';

/** Previous day, the day shown, next day (off at today). The label is a live region; the hook also announces each change. */
export function DateBar({ v }: { v: ViewedDate }) {
  const c = useTheme();
  const label = dateLabel(v.date, v.today);
  const sub = dateSub(v.date);
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
