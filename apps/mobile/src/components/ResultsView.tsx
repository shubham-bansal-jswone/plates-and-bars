import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WhyLink } from '../why/WhyLink';
import { Text } from './Text';
import { fmt } from '../format';
import { buildResults } from '../setup/results';
import type { Profile } from '../setup/types';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ClearanceCard } from './ClearanceCard';
import { Button, Card, H1, Hint, Label, Note } from './ui';

/** Notes that carry a Why link in the prototype (`resultsHtml`). */
const NOTE_WHY: Record<string, string> = { home_dumbbells: 'home', home_bodyweight: 'home', older: 'older' };

/**
 * The prototype's results block: burn, breakdown, daily targets and notes, all from `calcTargets` output.
 * `onCleared` shows the clearance card with its "My doctor has cleared me" button.
 */
export function ResultsView({ profile, onCleared, hideTargets, hideHeadline, showWhy }: { profile: Profile; onCleared?: () => void; hideTargets?: boolean; hideHeadline?: boolean; /** Setup results: the expandable "Why these numbers?" block. */ showWhy?: boolean }) {
  const c = useTheme();
  const [whyOpen, setWhyOpen] = useState(false);
  const v = buildResults(profile);
  const t = v.r;
  const tiles: [string, string, string][] = [
    [fmt(t.kcal), 'kcal', c.ink],
    [String(t.protein), 'g protein', c.protein],
    [String(t.carbs), 'g carbs', c.carbs],
    [String(t.fat), 'g fat', c.fat],
  ];
  return (
    <View style={styles.wrap}>
      {hideHeadline ? null : <H1>{v.headline}</H1>}
      <Hint>{v.range}</Hint>
      {v.rows.map(([label, kcal]) => (
        <View key={label} style={[styles.row, { borderColor: c.line }]} accessible accessibilityLabel={`${label}, ${fmt(kcal)} kilocalories`}>
          <Text style={{ color: c.ink }}>{label}</Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(kcal)}</Text>
        </View>
      ))}
      {hideTargets ? null : (
        <>
          <Label>Your daily targets</Label>
          <View style={styles.grid}>
            {tiles.map(([n, unit, color], i) => (
              <Card
                key={unit}
                testID={`target-${i}`}
                accessible
                accessibilityLabel={`${n} ${unit}`}
                style={styles.tile}
              >
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={[styles.num, { color: c.ink }]}>{n}</Text>
                <Text style={{ color: c.body, fontSize: 13 }}>{unit}</Text>
              </Card>
            ))}
          </View>
        </>
      )}
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
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', alignItems: 'center', gap: 2 },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  num: { fontSize: 26, fontWeight: '300' },
});
