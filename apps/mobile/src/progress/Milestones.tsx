import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Milestone } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, Heading, Hint } from '../components/ui';
import { shortDate } from '../format';
import { space, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { milestoneLine } from '../workout/copy';
import { MILESTONES_EMPTY, MILESTONES_TITLE } from './copy';

export const MILESTONES_FIRST = 5;

/**
 * Progress, Strength section (after Recent PRs): milestones earned, newest first (core's `milestones` order), the last 5 and "Show all". Earned only: no points,
 * no locked entries. Each row reads as one line: title, detail, date. Nothing is shown before `milestones` is known (null).
 */
export function Milestones({ milestones }: { milestones: readonly Milestone[] | null }) {
  const c = useTheme();
  const [all, setAll] = useState(false);
  if (!milestones) return null;
  const shown = all ? milestones : milestones.slice(0, MILESTONES_FIRST);
  return (
    <View style={styles.section}>
      <Heading level={3} style={[typeScale.label, { color: c.ink }]}>{MILESTONES_TITLE}</Heading>
      {milestones.length === 0 ? (
        <Hint>{MILESTONES_EMPTY}</Hint>
      ) : (
        <>
          {shown.map((m) => (
            <Card key={m.id} accessible accessibilityLabel={`${milestoneLine(m)}, ${shortDate(m.date)}`} style={[styles.row, { backgroundColor: c.surfaceSoft }]}>
              <View style={styles.grow}>
                <Text style={[typeScale.bodyStrong, { color: c.ink }]}>{m.title}</Text>
                <Text style={[typeScale.small, { color: c.muted }]}>{m.detail}</Text>
              </View>
              <Text style={[typeScale.small, { color: c.muted }]}>{shortDate(m.date)}</Text>
            </Card>
          ))}
          {milestones.length > MILESTONES_FIRST ? <Button kind="ghost" label={all ? 'Show fewer' : `Show all ${milestones.length}`} onPress={() => setAll(!all)} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  grow: { flex: 1 },
});
