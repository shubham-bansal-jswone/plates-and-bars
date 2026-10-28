import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WhyLink } from '../why/WhyLink';
import { Text } from './Text';
import { fmt } from '../format';
import { buildResults } from '../setup/results';
import { useWeightUnit } from '../settings/weightUnit';
import type { Profile } from '../setup/types';
import { radius, space, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ClearanceCard } from './ClearanceCard';
import { Button, Card, H1, Heading, Hint, Note, useWide } from './ui';

/** Notes that carry a Why link in the prototype (`resultsHtml`). */
const NOTE_WHY: Record<string, string> = { home_dumbbells: 'home', home_bodyweight: 'home', older: 'older' };

/**
 * The prototype's results block: burn, breakdown, daily targets and notes, all from `calcTargets` output.
 * `onCleared` shows the clearance card with its "My doctor has cleared me" button.
 */
export function ResultsView({ profile, onCleared, hideTargets, hideHeadline, showWhy, columns }: { profile: Profile; onCleared?: () => void; hideTargets?: boolean; hideHeadline?: boolean; /** Two columns on a screen >= 900px (the page must be `wide`). */ columns?: boolean; /** Setup results: the expandable "Why these numbers?" block. */ showWhy?: boolean }) {
  const c = useTheme();
  const [whyOpen, setWhyOpen] = useState(false);
  const { unit } = useWeightUnit();
  const v = buildResults(profile, unit);
  const t = v.r;
  const wide = useWide();
  const two = !!columns && wide;
  const tiles: [string, string, string][] = [
    [String(t.protein), 'g protein', c.protein],
    [String(t.carbs), 'g carbs', c.carbs],
    [String(t.fat), 'g fat', c.fat],
  ];
  const left = (
    <View style={styles.wrap}>
      {hideHeadline ? null : <H1>{v.headline}</H1>}
      <View style={{ paddingBottom: space.sm }}>
        <Hint>{v.range}</Hint>
      </View>
      {v.rows.map(([label, kcal]) => (
        <View key={label} style={[styles.row, { borderColor: c.line }]} accessible accessibilityLabel={`${label}, ${fmt(kcal)} kilocalories`}>
          <Text style={{ color: c.ink }}>{label}</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(kcal)}</Text>
        </View>
      ))}
      {hideTargets ? null : (
        <>
          <Heading level={2} style={[type.heading, { color: c.ink, marginTop: 8 }]}>Your daily targets</Heading>
          <Card testID="target-0" accessible accessibilityLabel={`${fmt(t.kcal)} kcal`} style={styles.hero}>
            <Text style={[type.metric, tabular, { color: c.brand }]}>{fmt(t.kcal)}</Text>
            <Text style={[type.small, { color: c.muted }]}>kcal a day</Text>
          </Card>
          <View style={styles.grid}>
            {tiles.map(([n, unit, color], i) => (
              <View key={unit} testID={`target-${i + 1}`} accessible accessibilityLabel={`${n} ${unit}`} style={[styles.tile, { borderColor: c.line }]}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={[type.metricSm, tabular, { color: c.ink }]}>{n}</Text>
                <Text style={[type.small, { color: c.muted }]}>{unit}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
  const right = (
    <View style={styles.wrap}>
      <Hint>{v.pace}</Hint>
      <ClearanceCard profile={profile} onCleared={onCleared} />
      {v.notes.map((n, i) => {
        const why = NOTE_WHY[v.noteKeys[i] as string];
        return (
          <Fragment key={n}>
            <Note>{n}</Note>
            {why ? <WhyLink id={why} /> : null}
          </Fragment>
        );
      })}
      {showWhy ? (
        <>
          <Button kind="link" label="Why these numbers?" expanded={whyOpen} onPress={() => setWhyOpen(!whyOpen)} />
          {whyOpen
            ? v.why.map((l) => (
                <Text key={l.head} style={{ color: c.body, lineHeight: 21 }}>
                  <Text style={{ color: c.ink, fontWeight: '700' }}>{l.head}</Text>
                  {` ${l.text}`}
                  {l.ev ? <Text style={{ color: c.ink, fontWeight: '700' }}>{` ${l.ev}`}</Text> : null}
                  {l.after ? ` ${l.after}` : null}
                </Text>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
  return two ? (
    <View style={styles.cols}>
      <View style={styles.col}>{left}</View>
      <View style={styles.col}>{right}</View>
    </View>
  ) : (
    <View style={styles.wrap}>
      {left}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hero: { alignItems: 'flex-start', gap: 0 },
  tile: { flexGrow: 1, flexBasis: '28%', borderWidth: 1, borderRadius: radius.lg, padding: 12, gap: 2 },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  cols: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  col: { flex: 1 },
});
