import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Card } from '../components/ui';
import { space, tabular, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export interface Metric {
  big: string;
  /** Smaller text after the number, e.g. " / 6". */
  small?: string;
  label: string;
}

/** A card of oversized italic numbers with small muted labels and thin vertical dividers between them. The first one is the key number (lime). */
export function MetricRow({ items }: { items: readonly Metric[] }) {
  const c = useTheme();
  return (
    <Card style={styles.row}>
      {items.map((m, i) => (
        <View key={m.label} style={styles.item}>
          {i > 0 ? <View style={[styles.divider, { backgroundColor: c.line }]} /> : null}
          <View style={styles.cell} accessible accessibilityLabel={`${m.big}${m.small ?? ''} ${m.label}`}>
            <Text style={[typeScale.metricSm, tabular, { color: i === 0 ? c.brand : c.ink }]}>
              {m.big}
              {m.small ? <Text style={[typeScale.small, { color: c.muted }]}>{m.small}</Text> : null}
            </Text>
            <Text style={[typeScale.small, { color: c.muted }]}>{m.label}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: space.md },
  item: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  divider: { width: 1, marginVertical: 2 },
  cell: { flex: 1, paddingHorizontal: space.sm, gap: 2, justifyContent: 'center' },
});
