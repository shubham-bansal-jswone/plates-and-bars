import { StyleSheet, Text, View } from 'react-native';
import { fmt } from '../format';
import { buildResults, clearanceNote } from '../setup/results';
import type { Profile } from '../setup/types';
import { useTheme } from '../theme/useTheme';
import { Button, H1, Hint, Label, Note } from './ui';

/**
 * The prototype's results block: burn, breakdown, daily targets and notes, all from `calcTargets` output.
 * `onCleared` shows the clearance card with its "My doctor has cleared me" button.
 */
export function ResultsView({ profile, onCleared }: { profile: Profile; onCleared?: () => void }) {
  const c = useTheme();
  const v = buildResults(profile);
  const clear = clearanceNote(profile);
  const t = v.r;
  const tiles: [string, string, string][] = [
    [fmt(t.kcal), 'kcal', c.brand],
    [String(t.protein), 'g protein', c.protein],
    [String(t.carbs), 'g carbs', c.carbs],
    [String(t.fat), 'g fat', c.fat],
  ];
  return (
    <View style={styles.wrap}>
      <H1>{v.headline}</H1>
      <Hint>{v.range}</Hint>
      {v.rows.map(([label, kcal]) => (
        <View key={label} style={[styles.row, { borderColor: c.line }]} accessible accessibilityLabel={`${label}, ${fmt(kcal)} kilocalories`}>
          <Text style={{ color: c.ink }}>{label}</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(kcal)}</Text>
        </View>
      ))}
      <Label>Your daily targets</Label>
      <View style={styles.grid}>
        {tiles.map(([n, unit, color], i) => (
          <View
            key={unit}
            testID={`target-${i}`}
            accessible
            accessibilityLabel={`${n} ${unit}`}
            style={[styles.tile, { backgroundColor: c.surface, borderColor: c.line }]}
          >
            <Text style={[styles.num, { color }]}>{n}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{unit}</Text>
          </View>
        ))}
      </View>
      <Hint>{v.pace}</Hint>
      {clear ? (
        <View style={[styles.card, { borderColor: c.danger, backgroundColor: c.surface }]}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '700', fontSize: 16 }}>
            {clear.title}
          </Text>
          <Text style={{ color: c.ink, lineHeight: 20 }}>{clear.body}</Text>
          {onCleared ? <Button label="My doctor has cleared me" onPress={onCleared} /> : null}
        </View>
      ) : null}
      {v.notes.map((n) => (
        <Note key={n}>{n}</Note>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  num: { fontSize: 26, fontWeight: '800' },
  card: { borderWidth: 2, borderRadius: 12, padding: 12, gap: 6 },
});
