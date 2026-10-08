import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { calcTargets, type TargetsProfile } from '@plate-and-bar/core';
import { useTheme } from '../theme/useTheme';

/** Fixed demo profile (the `male-30-lose-moderate` case of docs/spec/golden/targets.json). */
export const DEMO_PROFILE: TargetsProfile = {
  sex: 'male',
  age: 30,
  height: 165,
  weight: 82,
  activity: 'sitting',
  days: 6,
  minutes: 60,
  goal: 'lose',
  pace: 'moderate',
  special: 'none',
};

export function TargetsScreen() {
  const c = useTheme();
  const t = calcTargets(DEMO_PROFILE);
  const rows: [string, string, string][] = [
    ['Protein', `${t.protein} g`, c.protein],
    ['Carbs', `${t.carbs} g`, c.carbs],
    ['Fat', `${t.fat} g`, c.fat],
  ];
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Text accessibilityRole="header" style={[styles.h, { color: c.ink }]}>
          Daily targets
        </Text>
        <Text testID="kcal" accessibilityLabel={`${t.kcal} kilocalories a day`} style={[styles.kcal, { color: c.brand }]}>
          {t.kcal} kcal
        </Text>
        <Text style={[styles.hint, { color: c.muted }]}>
          Estimated burn: about {Math.round(t.tdee)} kcal a day.
        </Text>
        {rows.map(([label, value, color]) => (
          <View key={label} style={[styles.row, { borderColor: c.line }]}>
            <Text style={{ color: c.ink }}>{label}</Text>
            <Text style={{ color }}>{value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  h: { fontSize: 18, fontWeight: '700' },
  kcal: { fontSize: 32, fontWeight: '800', marginVertical: 8 },
  hint: { fontSize: 14, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1 },
});
