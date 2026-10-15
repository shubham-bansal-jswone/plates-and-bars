import { StyleSheet, View } from 'react-native';
import { weekSummary, type ProgressDay } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Heading, Hint } from '../components/ui';
import { dayName, fmt, shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  date: string;
  /** Days read for the check-in, null while loading. */
  days: readonly ProgressDay[] | null;
  kcalTarget: number;
}

/** Progress tab, last block: "Seven days to <date>" (prototype `renderProgress`): a calorie bar per day, then averages and sessions. */
export function WeekCard({ date, days, kcalTarget }: Props) {
  const c = useTheme();
  const w = days ? weekSummary(days, date, kcalTarget) : null;
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{`Seven days to ${shortDate(date)}`}</Heading>
      {!w ? (
        <Hint>Loading…</Hint>
      ) : (
        <>
          {w.days.map((d) => (
            <View key={d.date} style={styles.row}>
              <View style={styles.lab}>
                <Text style={{ color: c.ink, fontWeight: '700' }}>{dayName(d.date)}</Text>
                {d.trained ? <Text style={{ color: c.muted, fontSize: 12 }}>trained</Text> : null}
              </View>
              <View
                style={[styles.bar, { backgroundColor: c.track }]}
                accessible
                accessibilityRole="image"
                accessibilityLabel={`${dayName(d.date)}${d.trained ? ', trained' : ''}, ${d.logged ? `${fmt(d.kcal)} kcal, ${fmt(d.protein_g)} g protein` : 'not logged'}`}
              >
                <View style={[styles.fill, { width: `${d.fillPct}%`, backgroundColor: d.over ? c.caution : c.brand }]} />
                <View style={[styles.tgt, { left: `${d.targetPct}%`, backgroundColor: c.ink }]} />
                <View style={styles.txt}>
                  <Text style={{ color: c.ink, fontSize: 13 }}>{d.logged ? `${fmt(d.kcal)} kcal` : 'not logged'}</Text>
                  <Text style={{ color: c.ink, fontSize: 13 }}>{d.logged ? `${fmt(d.protein_g)} g P` : ''}</Text>
                </View>
              </View>
            </View>
          ))}
          <View style={styles.avg}>
            <Avg big={w.avgKcal === null ? '–' : fmt(w.avgKcal)} label="avg kcal" />
            <Avg big={w.avgProtein_g === null ? '–' : `${fmt(w.avgProtein_g)} g`} label="avg protein" />
            <Avg big={String(w.sessions)} label="sessions" />
          </View>
          <Hint>The dark line on each bar is your calorie target.</Hint>
        </>
      )}
    </View>
  );
}

function Avg({ big, label }: { big: string; label: string }) {
  const c = useTheme();
  return (
    <View style={styles.avgItem} accessible accessibilityLabel={`${big} ${label}`}>
      <Text style={[typeScale.title, { color: c.ink }]}>{big}</Text>
      <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lab: { width: 56 },
  bar: { flex: 1, minHeight: 32, borderRadius: 8, overflow: 'hidden', justifyContent: 'center' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, opacity: 0.35 },
  tgt: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  txt: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  avg: { flexDirection: 'row', gap: 8, marginTop: 4 },
  avgItem: { flex: 1, alignItems: 'center' },
});
