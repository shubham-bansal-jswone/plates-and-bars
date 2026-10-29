import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { WAIST_CHART_BOX, type MeasureKey } from '@plate-and-bar/core';
import { Chip, Heading } from '../components/ui';
import { shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { MEASURE_PART_GROUP, MEASURE_TREND_NONE, WAIST_TREND_NONE, getMeasures } from './copy';
import { choosePart, partName } from './measureParts';
import { RangedTrend } from './RangedTrend';

type Tapes = Parameters<typeof choosePart>[0];
const sameCm = (cm: number): number => cm;

/**
 * The Measurements card's chart: chips for every tape part with at least 2 readings, and the chosen part as a `RangedTrend`.
 * The part is held in memory only; waist is shown whenever it has data. `waistExtras` (the body-fat estimate) shows only for waist.
 */
export function MeasureTrend({ tapes, end, waistExtras }: { tapes: Tapes; end: string; waistExtras: ReactNode }) {
  const c = useTheme();
  const defs = getMeasures();
  const [choice, setChoice] = useState<MeasureKey | null>(null);
  const { chips, shown, series } = choosePart(tapes, defs.map((d) => d.key), end, choice);
  const label = partName(defs.find((d) => d.key === shown)?.label ?? 'Waist');
  const isWaist = shown === 'waist_cm';
  return (
    <>
      {series.length >= 1 || chips.length > 1 ? (
        <>
          <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{label}</Heading>
          {chips.length > 1 ? (
            <View accessibilityRole="group" accessibilityLabel={MEASURE_PART_GROUP} style={styles.chips}>
              {chips.map((k) => {
                const name = partName(defs.find((d) => d.key === k)?.label ?? k);
                return <Chip key={k} label={name} pressed={k === shown} onPress={() => setChoice(k)} />;
              })}
            </View>
          ) : null}
          <RangedTrend
            key={shown}
            series={series}
            end={end}
            convert={sameCm}
            unit="cm"
            noun={label}
            box={WAIST_CHART_BOX}
            none={isWaist ? WAIST_TREND_NONE : MEASURE_TREND_NONE(label)}
            changeLine={(ch) => (ch.direction === 'none' ? `No change in ${label.toLowerCase()} since ${shortDate(ch.since)}.` : `${label} ${ch.direction} ${ch.amount} cm since ${shortDate(ch.since)}.`)}
          />
        </>
      ) : null}
      {isWaist ? waistExtras : null}
    </>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
