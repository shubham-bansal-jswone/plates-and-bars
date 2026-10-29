import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
  /** Optional second line under the date and value, e.g. a target, the gap to it and a flag. */
  note?: string;
}

/**
 * Web gets real table semantics (table > row > columnheader/cell, which react-native-web passes through); native keeps one
 * accessible label per row, because TalkBack and VoiceOver read a row as a single stop, not cell by cell.
 */
const rowProps = (web: boolean, label: string) => (web ? { role: 'row' as const } : { accessible: true, accessibilityRole: 'text' as const, accessibilityLabel: label });
const cellRole = (web: boolean, role: 'columnheader' | 'cell') => (web ? { role } : {});

/**
 * The text alternative of a chart: a 44px "Show as table" button that opens date and value rows, newest first, the last 12 until "Show all".
 * Give it the rows the chart draws, oldest first. `noun` names it for a screen reader ("Weight values by date"); `dateHeader` names the first column (default "Date").
 */
export function ChartTable({ rows, noun, valueHeader, dateHeader = TABLE_DATE }: { rows: readonly ChartRow[]; noun: string; valueHeader: string; dateHeader?: string }) {
  const c = useTheme();
  const web = Platform.OS === 'web';
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
        <>
        <View {...(web ? { role: 'table' as const, 'aria-label': TABLE_LABEL(noun) } : { accessibilityRole: 'list' as const, accessibilityLabel: TABLE_LABEL(noun) })}>
          <View style={[styles.row, { borderBottomColor: c.line }]} {...rowProps(web, `${dateHeader}, ${valueHeader}`)}>
            <Text {...cellRole(web, 'columnheader')} style={[typeScale.small, { color: c.muted }]}>{dateHeader}</Text>
            <Text {...cellRole(web, 'columnheader')} style={[typeScale.small, { color: c.muted }]}>{valueHeader}</Text>
          </View>
          {shown.map((r) => (
            <View key={r.date} style={[styles.row, { borderBottomColor: c.line }]} {...rowProps(web, `${dateWithYear(r.date)}, ${r.value}${r.note ? `, ${r.note}` : ''}`)}>
              <View style={styles.dateCol} {...cellRole(web, 'cell')}>
                <Text style={{ color: c.ink }}>{dateWithYear(r.date)}</Text>
                {r.note ? <Text style={[typeScale.small, { color: c.muted }]}>{r.note}</Text> : null}
              </View>
              <Text {...cellRole(web, 'cell')} style={[tabular, styles.valueCol, { color: c.ink, fontWeight: '700' }]}>{r.value}</Text>
            </View>
          ))}
        </View>
        {newest.length > TABLE_RECENT_ROWS ? (
          <Press accessibilityRole="button" accessibilityLabel={all ? TABLE_SHOW_RECENT(TABLE_RECENT_ROWS) : TABLE_SHOW_ALL} onPress={() => setAll(!all)} style={[styles.button, { borderColor: c.outline }]}>
            <Text style={[typeScale.buttonSm, { color: c.ink }]}>{all ? TABLE_SHOW_RECENT(TABLE_RECENT_ROWS) : TABLE_SHOW_ALL}</Text>
          </Press>
        ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: CHART_MAX_WIDTH, gap: space.sm },
  button: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1, borderRadius: radius.full },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, borderBottomWidth: 1 },
  valueCol: { flexShrink: 0, marginLeft: space.md },
  dateCol: { flexShrink: 1, paddingVertical: 2 },
});
