import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { latestWeight, milestones as milestonesOf, personalRecords, WEIGHT_CHART_BOX, type SessionLog } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Card, Heading, Hint, Press, a11yState } from '../components/ui';
import { dateWithYear, shortDate } from '../format';
import { useWeightUnit } from '../settings/weightUnit';
import { useProfile } from '../state/ProfileProvider';
import { radius, space, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { PR_LABEL, prText } from '../workout/copy';
import { weightNumber } from '../workout/unitText';
import { Milestones } from './Milestones';
import { E1RM_NOTE } from './E1rmTrend';
import { RangedTrend } from './RangedTrend';
import { leadLift, liftChoices, liftSeries } from './strength';
import { CHOOSE_LIFT, CHOOSE_LIFT_LIST, LIFT_CHIPS, PR_NONE, PR_TITLE, STRENGTH_EMPTY, STRENGTH_ERROR, STRENGTH_LOADING, STRENGTH_TITLE, strengthSentence } from './strengthCopy';
import type { ProgressSets } from './useProgressSets';

/** Rows of recent personal bests: fewer on a phone-width screen. */
const PR_ROWS = 5;
const PR_ROWS_NARROW = 3;
const NARROW = 400;

interface Props {
  /** From `useProgressSets`, called once by the screen and shared with Training volume, so all history is read once. */
  sets: ProgressSets;
  /** The viewed date: lifts, ranges and bests count up to it. */
  date: string;
  /** Weigh-ins, for the bodyweight that scores assisted lifts. */
  weights: Parameters<typeof latestWeight>[0];
  /** The session log from `useCheckin` (null until read), for the workout-count and plan milestones. */
  sessions?: SessionLog | null | undefined;
}

/**
 * Progress, Strength: the lead lift's estimated 1-rep max with its change, chips to switch lift, a ranged e1RM line with a table alternative,
 * and recent personal bests from all history. All history is read once by `useProgressSets`; nothing here reads the db again.
 */
export function StrengthSection({ sets, date, weights, sessions = null }: Props) {
  const c = useTheme();
  const { profile } = useProfile();
  const { all, types, inRange, loading, error } = sets;
  const bodyweight = latestWeight(weights, date) ?? profile?.weight_kg ?? null;
  return (
    <Card style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: c.ink }]}>{STRENGTH_TITLE}</Heading>
      {/* An old read is never shown as current after a failure. */}
      {error ? (
        <View accessible accessibilityRole="alert"><Hint>{STRENGTH_ERROR}</Hint></View>
      ) : loading && all.length === 0 ? (
        <Hint>{STRENGTH_LOADING}</Hint>
      ) : (
        <StrengthBody all={all} types={types} inRange={inRange} date={date} bodyweight={bodyweight} weights={weights} sessions={sessions} />
      )}
    </Card>
  );
}

type Loaded = Pick<ProgressSets, 'all' | 'types' | 'inRange'>;

function StrengthBody({ all, types, inRange, date, bodyweight, weights, sessions }: Loaded & { date: string; bodyweight: number | null; weights: Props['weights']; sessions: SessionLog | null }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
  const { profile } = useProfile();
  // Large text counts as a narrower screen: rows wrap and five tall rows would push the page down.
  const { width, fontScale } = useWindowDimensions();
  const narrow = width / (fontScale || 1) <= NARROW;
  const [choice, setChoice] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const choices = useMemo(() => liftChoices(all, types, date), [all, types, date]);
  const lift = leadLift(choices, choice);
  const series = useMemo(() => (lift ? liftSeries(inRange, date, lift, types[lift]) : []), [inRange, date, lift, types]);
  const toShown = useCallback((kg: number) => weightNumber(kg, unit), [unit]);
  const records = useMemo(() => personalRecords(all, types, bodyweight), [all, types, bodyweight]);
  const recent = useMemo(() => records.filter((r) => r.date <= date), [records, date]);

  const milestoneList = useMemo(() => (sessions ? milestonesOf(all, sessions, weights, types, unit, date, profile) : null), [all, sessions, weights, types, unit, date, profile]);

  const summary = useCallback((f: { date: string; v: number }, l: { date: string; v: number }) => (lift ? strengthSentence(lift, { date: l.date, kg: l.v }, { date: f.date, kg: f.v }, unit) : ''), [lift, unit]);
  const last = series[series.length - 1];
  const sentence = lift && last ? strengthSentence(lift, { date: last.date, kg: last.v }, null, unit) : '';
  const chips = lift && !choices.main.includes(lift) ? [...choices.main, lift] : choices.main;
  const others = choices.more.filter((l) => !chips.includes(l));
  const hide = { 'aria-hidden': true, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;

  return (
    <>
      {!last || !lift ? (
        <Hint>{STRENGTH_EMPTY}</Hint>
      ) : (
        <View style={styles.block}>
          {chips.length + others.length > 1 ? (
            <View accessibilityRole="group" accessibilityLabel={LIFT_CHIPS} style={styles.chips}>
              {chips.map((l) => (
                <Chip key={l} label={l} selected={l === lift} onPress={() => { setChoice(l); setListOpen(false); }} />
              ))}
              {others.length > 0 ? <Chip label={CHOOSE_LIFT} expanded={listOpen} onPress={() => setListOpen(!listOpen)} /> : null}
            </View>
          ) : null}
          {listOpen ? (
            <View accessibilityRole="list" accessibilityLabel={CHOOSE_LIFT_LIST} style={styles.list}>
              {others.map((l) => (
                <Press key={l} accessibilityRole="button" accessibilityLabel={l} onPress={() => { setChoice(l); setListOpen(false); }} style={[styles.row, { borderBottomColor: c.line }]}>
                  <Text style={{ color: c.ink }}>{l}</Text>
                </Press>
              ))}
            </View>
          ) : null}
          <View {...hide} testID="lead-number">
            <Text style={[typeScale.metricSm, { color: c.ink }]}>{`${weightNumber(last.v, unit)} ${unit}`}</Text>
          </View>
          {series.length >= 2 ? (
            <RangedTrend
              series={series}
              end={date}
              convert={toShown}
              unit={unit}
              noun={`${lift} estimated 1-rep max`}
              box={WEIGHT_CHART_BOX}
              summary={summary}
            />
          ) : (
            <Text style={[typeScale.textBody, { color: c.body }]}>{sentence}</Text>
          )}
          <Text style={[typeScale.caption, { color: c.muted }]}>{E1RM_NOTE}</Text>
        </View>
      )}
      <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{PR_TITLE}</Heading>
      {recent.length === 0 ? <Hint>{PR_NONE}</Hint> : null}
      {recent.slice(0, narrow ? PR_ROWS_NARROW : PR_ROWS).map((r) => {
        const when = r.date.slice(0, 4) === date.slice(0, 4) ? shortDate(r.date) : dateWithYear(r.date);
        const text = prText(r.lift, r, unit, types[r.lift] ?? 'other');
        return (
          <View key={`${r.lift}|${r.date}`} style={[styles.pr, { backgroundColor: c.surfaceSoft }]} accessible accessibilityLabel={`${PR_LABEL}, ${text}, ${when}`}>
            <Text style={[typeScale.small, { color: c.brand }]}>{PR_LABEL}</Text>
            <Text style={[typeScale.label, { color: c.ink }]}>{text}</Text>
            <Text style={[typeScale.caption, { color: c.muted }]}>{when}</Text>
          </View>
        );
      })}
      <Milestones milestones={milestoneList} />
    </>
  );
}

function Chip({ label, selected, expanded, onPress }: { label: string; selected?: boolean; expanded?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      {...a11yState({ pressed: selected, expanded })}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.brand : c.surfaceSoft }]}
    >
      <Text style={[typeScale.buttonSm, { color: selected ? c.onBrand : c.ink, fontWeight: selected ? '800' : '500' }]}>{label}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.full },
  list: { width: '100%' },
  row: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 1 },
  pr: { gap: 2, padding: space.md, borderRadius: radius.md },
});
