import { StyleSheet, View } from 'react-native';
import { weekSummary, type ProgressDay } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Heading, Hint } from '../components/ui';
import { dayName, fmt, shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { WEEK_AVG_KCAL, WEEK_AVG_PROTEIN, WEEK_LOADING, WEEK_NOT_LOGGED, WEEK_SESSIONS, WEEK_TARGET_HINT, WEEK_TITLE, WEEK_TRAINED } from './copy';

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
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{WEEK_TITLE(shortDate(date))}</Heading>
      {!w ? (
        <Hint>{WEEK_LOADING}</Hint>
      ) : (
        <>
          {w.days.map((d) => (
            <View key={d.date} style={styles.row}>
              <View style={styles.lab}>
                <Text style={{ color: c.ink, fontWeight: '700' }}>{dayName(d.date)}</Text>
                {d.trained ? <Text style={{ color: c.muted, fontSize: 12 }}>{WEEK_TRAINED}</Text> : null}
              </View>
              <View
                style={[styles.bar, { backgroundColor: c.track }]}
                accessible
                accessibilityRole="image"
                // Matches the prototype's bar label (#503, #588): the day, ", trained" when it was, then the kcal and
                // protein, or "not logged" on a blank day. A test asserts this string.
                accessibilityLabel={`${dayName(d.date)}${d.trained ? `, ${WEEK_TRAINED}` : ''}, ${d.logged ? `${fmt(d.kcal)} kcal, ${fmt(d.protein_g)} g protein` : WEEK_NOT_LOGGED}`}
              >
                <View style={[styles.fill, { width: `${d.fillPct}%`, backgroundColor: d.over ? c.caution : c.bar }]} />
                <View style={[styles.tgt, { left: `${d.targetPct}%`, backgroundColor: c.ink }]} />
                <View style={styles.txt}>
                  <Text style={{ color: c.ink, fontSize: 13 }}>{d.logged ? `${fmt(d.kcal)} kcal` : WEEK_NOT_LOGGED}</Text>
                  <Text style={{ color: c.ink, fontSize: 13 }}>{d.logged ? `${fmt(d.protein_g)} g P` : ''}</Text>
                </View>
              </View>
            </View>
          ))}
          <View style={styles.avg}>
            <Avg big={w.avgKcal === null ? '–' : fmt(w.avgKcal)} label={WEEK_AVG_KCAL} />
            <Avg big={w.avgProtein_g === null ? '–' : `${fmt(w.avgProtein_g)} g`} label={WEEK_AVG_PROTEIN} />
            <Avg big={String(w.sessions)} label={WEEK_SESSIONS} />
          </View>
          <Hint>{WEEK_TARGET_HINT}</Hint>
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
  // Prototype `.bar .fill{opacity:.85}`: the fill is the data mark, so it stays near-solid. Dropping it further
  // against `track` falls under the 3:1 a bar needs against its track.
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, opacity: 0.85 },
  // Prototype `.bar .tgt{opacity:.5}`: the target line is a quieter mark than the fill, so it keeps the prototype's
  // half opacity. A test asserts it.
  tgt: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.5 },
  txt: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  avg: { flexDirection: 'row', gap: 8, marginTop: 4 },
  avgItem: { flex: 1, alignItems: 'center' },
});
