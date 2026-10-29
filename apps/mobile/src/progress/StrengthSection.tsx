import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { latestWeight, personalRecords, WEIGHT_CHART_BOX, type SeriesRange } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Card, Heading, Hint, Press, a11yState } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { dateWithYear, shortDate } from '../format';
import { useWeightUnit } from '../settings/weightUnit';
import { useDataVersion } from '../sync/useDataVersion';
import { useOptionalSettings } from '../state/SettingsProvider';
import { useProfile } from '../state/ProfileProvider';
import { radius, space, tabular, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { weightNumber } from '../workout/unitText';
import { RANGE_NO_DATA } from './copy';
import { ChartTable } from './ChartTable';
import { E1RM_NOTE } from './E1rmTrend';
import { RANGES, RangeControl } from './RangeControl';
import { TrendChart } from './TrendChart';
import { leadLift, liftChoices, liftRanges, plotted } from './strength';
import { CHOOSE_LIFT, CHOOSE_LIFT_LIST, LIFT_CHIPS, PR_LABEL, PR_NONE, PR_TITLE, STRENGTH_EMPTY, STRENGTH_ERROR, STRENGTH_LOADING, STRENGTH_TITLE, prGain, prScore, strengthSentence } from './strengthCopy';
import { useProgressSets } from './useProgressSets';

/** Rows of recent personal bests: fewer on a phone-width screen. */
const PR_ROWS = 5;
const PR_ROWS_NARROW = 3;
const NARROW = 400;

interface Props {
  db: WorkoutDb;
  /** The viewed date: lifts, ranges and bests count up to it. */
  date: string;
  /** Weigh-ins, for the bodyweight that scores assisted lifts. */
  weights: Parameters<typeof latestWeight>[0];
}

/**
 * Progress, Strength: the lead lift's estimated 1-rep max with its change, chips to switch lift, a ranged e1RM line with a table alternative,
 * and recent personal bests from all history. All history is read once by `useProgressSets`; nothing here reads the db again.
 */
export function StrengthSection({ db, date, weights }: Props) {
  const c = useTheme();
  const settings = useOptionalSettings();
  const { profile } = useProfile();
  const sets = useProgressSets(db, useDataVersion(), settings?.settings.exercise_overrides);
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
        <StrengthBody all={all} types={types} inRange={inRange} date={date} bodyweight={bodyweight} />
      )}
    </Card>
  );
}

type Loaded = Pick<ReturnType<typeof useProgressSets>, 'all' | 'types' | 'inRange'>;

function StrengthBody({ all, types, inRange, date, bodyweight }: Loaded & { date: string; bodyweight: number | null }) {
  const c = useTheme();
  const { unit } = useWeightUnit();
  const narrow = useWindowDimensions().width <= NARROW;
  const [choice, setChoice] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [rangeChoice, setRangeChoice] = useState<SeriesRange>('12w');

  const choices = useMemo(() => liftChoices(all, types, date), [all, types, date]);
  const lift = leadLift(choices, choice);
  const ranged = useMemo(() => (lift ? liftRanges(inRange, date, lift, types[lift]) : null), [inRange, date, lift, types]);
  const records = useMemo(() => personalRecords(all, types, bodyweight), [all, types, bodyweight]);
  const recent = useMemo(() => records.filter((r) => r.date <= date), [records, date]);

  const disabled = new Set(ranged ? RANGES.filter((r) => ranged[r].length < 2) : []);
  // The choice is kept; only what is drawn falls back to the next wider range with a line.
  const range = RANGES.slice(RANGES.indexOf(rangeChoice)).find((r) => !disabled.has(r)) ?? 'all';
  const view = useMemo(() => {
    if (!lift || !ranged) return null;
    const pts = plotted(ranged[range].length >= 2 ? ranged[range] : ranged.all);
    const first = pts[0], last = pts[pts.length - 1];
    if (!last) return null;
    const line = pts.length >= 2 && first ? { first: { date: first.date, kg: first.v }, last: { date: last.date, kg: last.v } } : null;
    return { pts, last, line };
  }, [lift, ranged, range]);

  const sentence = view && lift ? strengthSentence(lift, { date: view.last.date, kg: view.last.v }, view.line?.first ?? null, unit) : '';
  const chips = lift && !choices.main.includes(lift) ? [...choices.main, lift] : choices.main;
  const others = choices.more.filter((l) => !chips.includes(l));
  const hide = { 'aria-hidden': true, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;

  return (
    <>
      {!view || !lift ? (
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
            <Text style={[typeScale.metricSm, { color: c.ink }]}>{`${weightNumber(view.last.v, unit)} ${unit}`}</Text>
          </View>
          {view.line ? (
            <>
              <View {...hide}><Text style={[typeScale.textBody, { color: c.body }]}>{sentence}</Text></View>
              <RangeControl value={range} disabled={disabled} onChange={setRangeChoice} noun={`${lift} e1RM`} />
              {RANGES.filter((r) => disabled.has(r)).map((r) => <Hint key={r}>{RANGE_NO_DATA(r)}</Hint>)}
              <TrendChart points={view.pts.map((p) => ({ date: p.date, v: weightNumber(p.v, unit) }))} box={WEIGHT_CHART_BOX} label={sentence} unit={unit} />
              <ChartTable rows={view.pts.map((p) => ({ date: p.date, value: `${weightNumber(p.v, unit)} ${unit}` }))} noun={`${lift} e1RM`} valueHeader={`e1RM (${unit})`} />
            </>
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
        const score = prScore(r, types[r.lift], unit);
        const gain = prGain(r, types[r.lift], unit);
        return (
          <View key={`${r.lift}|${r.date}`} style={[styles.pr, { backgroundColor: c.surfaceSoft }]} accessible accessibilityLabel={`${PR_LABEL}, ${r.lift}, ${score}, ${when}, ${gain}`}>
            <Text style={[typeScale.small, { color: c.brand }]}>{PR_LABEL}</Text>
            <View style={styles.prLine}>
              <Text style={[typeScale.label, { color: c.ink, flexShrink: 1 }]}>{r.lift}</Text>
              <Text style={[tabular, { color: c.ink, fontWeight: '700', flexShrink: 0 }]}>{score}</Text>
            </View>
            <Text style={[typeScale.caption, { color: c.muted }]}>{`${when} · ${gain}`}</Text>
          </View>
        );
      })}
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
  prLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
});
