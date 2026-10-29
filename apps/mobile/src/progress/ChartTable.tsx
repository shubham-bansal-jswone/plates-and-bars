import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Press, a11yState } from '../components/ui';
import { dateWithYear } from '../format';
import { CHART_MAX_WIDTH, radius, space, tabular, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { TABLE_DATE, TABLE_HIDE, TABLE_LABEL, TABLE_SHOW, TABLE_SHOW_ALL, TABLE_SHOW_RECENT } from './copy';

/** Rows shown before "Show all". */
export const TABLE_RECENT_ROWS = 12;

export interface ChartRow {
  date: string;
  /** Shown text, with its unit. */
  value: string;
}

/**
 * The text alternative of a chart: a 44px "Show as table" button that opens date and value rows, newest first, the last 12 until "Show all".
 * Give it the rows the chart draws, oldest first. `noun` names it for a screen reader ("Weight values by date").
 */
export function ChartTable({ rows, noun, valueHeader }: { rows: readonly ChartRow[]; noun: string; valueHeader: string }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const newest = [...rows].reverse();
  const shown = all ? newest : newest.slice(0, TABLE_RECENT_ROWS);
  return (
    <View style={styles.wrap}>
      <Press accessibilityRole="button" accessibilityLabel={open ? TABLE_HIDE : TABLE_SHOW} {...a11yState({ expanded: open })} onPress={() => setOpen(!open)} style={[styles.button, { borderColor: c.outline }]}>
        <Text style={[typeScale.buttonSm, { color: c.ink }]}>{open ? TABLE_HIDE : TABLE_SHOW}</Text>
      </Press>
      {open ? (
        <View accessibilityRole="list" accessibilityLabel={TABLE_LABEL(noun)}>
          <View style={[styles.row, { borderBottomColor: c.line }]} accessible accessibilityRole="text" accessibilityLabel={`${TABLE_DATE}, ${valueHeader}`}>
            <Text style={[typeScale.small, { color: c.muted }]}>{TABLE_DATE}</Text>
            <Text style={[typeScale.small, { color: c.muted }]}>{valueHeader}</Text>
          </View>
          {shown.map((r) => (
            <View key={r.date} style={[styles.row, { borderBottomColor: c.line }]} accessible accessibilityRole="text" accessibilityLabel={`${dateWithYear(r.date)}, ${r.value}`}>
              <Text style={{ color: c.ink }}>{dateWithYear(r.date)}</Text>
              <Text style={[tabular, { color: c.ink, fontWeight: '700' }]}>{r.value}</Text>
            </View>
          ))}
          {newest.length > TABLE_RECENT_ROWS ? (
            <Press accessibilityRole="button" accessibilityLabel={all ? TABLE_SHOW_RECENT(TABLE_RECENT_ROWS) : TABLE_SHOW_ALL} onPress={() => setAll(!all)} style={[styles.button, { borderColor: c.outline }]}>
              <Text style={[typeScale.buttonSm, { color: c.ink }]}>{all ? TABLE_SHOW_RECENT(TABLE_RECENT_ROWS) : TABLE_SHOW_ALL}</Text>
            </Press>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: CHART_MAX_WIDTH, gap: space.sm },
  button: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1, borderRadius: radius.full },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, borderBottomWidth: 1 },
});
