import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { COVER_SHOW, mondayOf, round1, WEIGHT_CHART_BOX, type VolumeVsPlan } from '@plate-and-bar/core';
import { Skeleton } from '../components/Skeleton';
import { Text } from '../components/Text';
import { Card, Chip, Heading, Hint, Press, a11yState } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { shortDate } from '../format';
import type { Settings } from '../settings/types';
import type { Profile } from '../setup/types';
import { useDataVersion } from '../sync/useDataVersion';
import { CHART_MAX_WIDTH, radius, space, tabular, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { muscleName } from '../workout/copy';
import { BarChart } from './BarChart';
import {
  VOL_AVG_NOTE,
  VOL_AVG_NOTE_FEW,
  VOL_BELOW_PLAN,
  VOL_CHART_LABEL,
  VOL_COUNT_BELOW_PLAN,
  VOL_EMPTY,
  VOL_ERROR,
  VOL_HEADLINE,
  VOL_LOW,
  VOL_MUSCLE_GROUP,
  VOL_NO_FULL_WEEK,
  VOL_NO_MUSCLE_TARGET,
  VOL_NO_SETUP,
  VOL_PLAN_LINE,
  VOL_PLAN_NOTE,
  VOL_PLAN_ROW,
  VOL_RANK_TITLE,
  VOL_ROW_LABEL,
  VOL_ROW_OF,
  VOL_SHOW_ALL,
  VOL_SHOW_FEWER,
  VOL_THIS_WEEK,
  VOL_TITLE,
  VOL_WEEK_OF,
} from './copy';
import { useProgressVolume } from './useProgressVolume';
import { defaultMuscle, noVolumeYet, rankRows, volumeBars } from './volumeView';

/** The section's chart box: 12 bars, so no wider than the weight chart's. */
const VOLUME_BOX = WEIGHT_CHART_BOX;
/** Muscles listed before "Show all", on a phone. */
const RANK_COLLAPSED = 3;
/** Under this width the ranked list is collapsed. */
const NARROW = 768;

const WORDING = { targetRow: VOL_PLAN_ROW, below: VOL_BELOW_PLAN, countBelow: VOL_COUNT_BELOW_PLAN };

const name = (m: string): string => {
  const t = muscleName(m);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const num = (n: number): string => round1(n).toLocaleString('en-IN');

interface Props {
  db: WorkoutDb;
  /** The viewed date: the last week drawn is the one it falls in. */
  date: string;
  today: string;
  profile: Profile | null;
  settings: Settings | null;
}

/**
 * Progress tab, Training volume: one muscle at a time as weekly done sets over 12 weeks, against the CURRENT plan, and a ranked
 * list of every muscle's last-4-week average (the text alternative to the chart). The muscle is held in memory only.
 */
export function VolumeSection({ db, date, today, profile, settings }: Props) {
  const c = useTheme();
  const dataVersion = useDataVersion();
  const { volume, loading, error } = useProgressVolume(db, date, today, dataVersion, profile, settings?.adjustments.weekPlan as Parameters<typeof useProgressVolume>[5]);
  const focus = settings?.focus ?? [];
  const [choice, setChoice] = useState<string | null>(null);
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{VOL_TITLE}</Heading>
      {error ? <Hint>{VOL_ERROR}</Hint> : null}
      {loading && !error ? <Skeleton heights={[150]} /> : null}
      {volume ? (noVolumeYet(volume.weeks, volume.since) ? <Hint>{VOL_EMPTY}</Hint> : <Body volume={volume} date={date} today={today} focus={focus} choice={choice} onChoice={setChoice} />) : null}
    </Card>
  );
}

function Body({ volume, date, today, focus, choice, onChoice }: { volume: NonNullable<ReturnType<typeof useProgressVolume>['volume']>; date: string; today: string; focus: readonly string[]; choice: string | null; onChoice: (m: string) => void }) {
  const c = useTheme();
  const { weeks, result, planned, since } = volume;
  const muscle = choice ?? defaultMuscle(focus, result.rows);
  const label = name(muscle);
  const bars = useMemo(() => volumeBars(weeks, muscle, since), [weeks, muscle, since]);
  const target = planned[muscle] || 0;
  const targetText = target > 0 ? num(target) : null;
  const week = weeks[weeks.length - 1];
  const when = mondayOf(date) === mondayOf(today) ? VOL_THIS_WEEK : VOL_WEEK_OF(shortDate(mondayOf(date)));
  const headline = VOL_HEADLINE(label, num(week?.sets[muscle] || 0), targetText, when);
  const hasPlan = Object.keys(planned).some((m) => (planned[m] || 0) > 0);
  return (
    <View style={styles.body}>
      <View accessibilityRole="group" accessibilityLabel={VOL_MUSCLE_GROUP} style={styles.chips}>
        {COVER_SHOW.map((m) => <Chip key={m} label={name(m)} pressed={m === muscle} onPress={() => onChoice(m)} />)}
      </View>
      {/* The chart's spoken label says the same: hidden here so a screen reader reads it once. */}
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={[typeScale.label, { color: c.ink }]}>{headline}</Text>
      </View>
      <BarChart
        bars={bars}
        box={VOLUME_BOX}
        label={`${VOL_CHART_LABEL(label)}. ${headline}`}
        unit="sets"
        noun={`${label} sets`}
        valueHeader="Sets"
        target={target > 0 ? { value: target, caption: VOL_PLAN_LINE(num(target)) } : undefined}
        wording={WORDING}
      />
      {target > 0 ? <Hint>{VOL_PLAN_NOTE}</Hint> : <Hint>{hasPlan ? VOL_NO_MUSCLE_TARGET(label) : VOL_NO_SETUP}</Hint>}
      <Ranked rows={result.rows} weeksUsed={result.weeksUsed} />
    </View>
  );
}

function Ranked({ rows, weeksUsed }: { rows: readonly VolumeVsPlan[]; weeksUsed: number }) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const [all, setAll] = useState(false);
  const ranked = useMemo(() => rankRows(rows), [rows]);
  const collapsible = width < NARROW;
  const shown = collapsible && !all ? ranked.slice(0, RANK_COLLAPSED) : ranked;
  return (
    <View style={styles.rank}>
      <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{VOL_RANK_TITLE}</Heading>
      {weeksUsed === 0 ? (
        <Hint>{VOL_NO_FULL_WEEK}</Hint>
      ) : (
        <>
          <Hint>{weeksUsed >= 4 ? VOL_AVG_NOTE : VOL_AVG_NOTE_FEW(weeksUsed)}</Hint>
          {shown.map((r) => {
            const t = r.target > 0 ? num(r.target) : null;
            return (
              <View key={r.muscle} accessible accessibilityLabel={VOL_ROW_LABEL(name(r.muscle), num(r.avg), t, r.below, r.low)} style={styles.row}>
                <Text style={[styles.muscle, { color: c.ink }]}>{name(r.muscle)}</Text>
                <View style={[styles.track, { backgroundColor: c.track }]}>
                  <View style={{ width: `${r.barPct}%`, height: 8, borderRadius: radius.full, backgroundColor: r.low ? c.caution : c.bar }} />
                </View>
                <View style={styles.figure}>
                  <Text style={[tabular, { color: r.low ? c.caution : c.ink, fontWeight: '700' }]}>{t ? VOL_ROW_OF(num(r.avg), t) : num(r.avg)}</Text>
                  {r.low ? <Text style={[typeScale.small, { color: c.caution }]}>{VOL_LOW}</Text> : null}
                </View>
              </View>
            );
          })}
          {collapsible && ranked.length > RANK_COLLAPSED ? (
            <Press accessibilityRole="button" accessibilityLabel={all ? VOL_SHOW_FEWER : VOL_SHOW_ALL} {...a11yState({ expanded: all })} onPress={() => setAll(!all)} style={[styles.button, { borderColor: c.outline }]}>
              <Text style={[typeScale.buttonSm, { color: c.ink }]}>{all ? VOL_SHOW_FEWER : VOL_SHOW_ALL}</Text>
            </Press>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  body: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rank: { gap: space.sm, marginTop: space.sm, width: '100%', maxWidth: CHART_MAX_WIDTH },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  muscle: { width: 96, fontSize: 14 },
  track: { flex: 1, height: 8, borderRadius: radius.full, overflow: 'hidden' },
  figure: { minWidth: 72, alignItems: 'flex-end' },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, alignSelf: 'flex-start' },
});
