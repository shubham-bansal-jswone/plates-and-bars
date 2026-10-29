import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WEIGHT_CHART_BOX, type ProgressDay } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Card, Heading, Hint } from '../components/ui';
import { fmt } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BarChart, type Bar } from './BarChart';
import { EATING_CHART_LABEL, EATING_EMPTY, EATING_ERROR, EATING_HEADLINE, EATING_HOLLOW_HINT, EATING_LOADING, EATING_NO_TARGET, EATING_NOUN, EATING_PROTEIN, EATING_TITLE, EATING_VALUE_HEADER } from './copy';
import { eatingView } from './eatingLogic';

interface Props {
  /** From `useWeeklyIntake`: null while read. */
  days: readonly ProgressDay[] | null;
  failed: boolean;
  /** The viewed day, the last week's end. */
  date: string;
  /** Current targets from the profile; 0 or less (or no profile) is "not set". */
  kcalTarget: number;
  proteinTarget: number;
}

/**
 * Progress tab: "Eating by week", under "Seven days". The 4-week average a day against the calorie target as the headline, then weekly
 * average kcal over 12 weeks as bars (a gap for a week with no logs, a hollow bar for one with few days logged); protein is the headline's
 * second line and a second line in each table row, not a second chart.
 */
export function EatingByWeek({ days, failed, date, kcalTarget, proteinTarget }: Props) {
  const c = useTheme();
  const kt = kcalTarget > 0 ? kcalTarget : 0, pt = proteinTarget > 0 ? proteinTarget : 0;
  const view = useMemo(() => (days ? eatingView(days, date, kt, pt) : null), [days, date, kt, pt]);
  const bars: Bar[] = useMemo(() => (view?.weeks ?? []).map((w) => ({ label: w.weekStart, value: w.avgKcal, partial: w.partial })), [view]);
  const extra = useMemo(() => (view?.weeks ?? []).map((w) => (w.avgProtein_g === null ? null : EATING_PROTEIN(fmt(w.avgProtein_g), null))), [view]);
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{EATING_TITLE}</Heading>
      {failed ? (
        <Hint>{EATING_ERROR}</Hint>
      ) : !view ? (
        <Hint>{EATING_LOADING}</Hint>
      ) : !view.enough || view.kcal === null || view.protein === null ? (
        <Hint>{EATING_EMPTY}</Hint>
      ) : (
        <>
          <View accessible accessibilityLabel={`${fmt(view.kcal)} ${EATING_HEADLINE(kt ? fmt(kt) : null)}. ${EATING_PROTEIN(fmt(view.protein), pt ? fmt(pt) : null)}`}>
            <Text style={[typeScale.title, { color: c.ink }]}>{fmt(view.kcal)}</Text>
            <Text style={{ color: c.muted }}>{EATING_HEADLINE(kt ? fmt(kt) : null)}</Text>
            <Text style={{ color: c.muted }}>{EATING_PROTEIN(fmt(view.protein), pt ? fmt(pt) : null)}</Text>
          </View>
          {kt ? null : <Hint>{EATING_NO_TARGET}</Hint>}
          <BarChart
            bars={bars}
            box={WEIGHT_CHART_BOX}
            label={EATING_CHART_LABEL}
            unit="kcal"
            noun={EATING_NOUN}
            valueHeader={EATING_VALUE_HEADER}
            format={fmt}
            target={kt ? { value: kt } : undefined}
            extra={extra}
          />
          <Hint>{EATING_HOLLOW_HINT}</Hint>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({ section: { gap: 8, marginTop: 16 } });
