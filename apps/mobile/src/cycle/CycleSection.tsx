import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { addDays, round1, sameDayLastCycle, waterRetentionPhase } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Field, Heading, Hint, Note } from '../components/ui';
import { shortDate } from '../format';
import { type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import type { Weight } from '../progress/types';
import {
  CYCLE_DATE_BAD, CYCLE_DATE_LABEL, CYCLE_DATE_PLACEHOLDER, CYCLE_DAY, CYCLE_INTRO, CYCLE_LATE, CYCLE_LIST, CYCLE_LOG, CYCLE_LOGGED_LIST, CYCLE_OF, CYCLE_OFF,
  CYCLE_PRIVATE, CYCLE_REMOVE_LAST, CYCLE_SAME_DAY, CYCLE_START_HINT, CYCLE_TITLE, CYCLE_TURN_ON, CYCLE_WATER_NOTE,
} from './copy';
import type { Cycle } from './useCycle';

/** Today or earlier, a real calendar date. */
const validStart = (v: string, today: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v && v <= today;

/** Progress tab, "Cycle log" (prototype `cycleHtml`): shown to women until they turn it on, and to anyone who has it on. Device only. */
export function CycleSection({ cycle, date, today, weights, female, notify }: { cycle: Cycle; date: string; today: string; weights: readonly Weight[]; female: boolean; notify: (msg: string) => void }) {
  const t = useTheme();
  const d = cycle.data;
  const [text, setText] = useState(date);
  if (!d) return null;
  if (!d.on) {
    if (!female) return null;
    return (
      <View style={styles.section}>
        <Heading level={2} style={[typeScale.heading, { color: t.ink }]}>{CYCLE_TITLE}</Heading>
        <Hint>{CYCLE_INTRO}</Hint>
        <Button label={CYCLE_TURN_ON} kind="ghost" onPress={() => void cycle.turnOn()} />
      </View>
    );
  }
  const c = cycle.info;
  const prev = c ? sameDayLastCycle(c) : null;
  const w = prev ? weights.find((x) => x.date === prev && !x.deleted_at) : undefined;
  const listed = d.starts.slice().sort().slice(-CYCLE_LIST).map(shortDate).join(', ');
  return (
    <View style={styles.section}>
      <Heading level={2} style={[typeScale.heading, { color: t.ink }]}>{CYCLE_TITLE}</Heading>
      {c ? (
        <>
          <Text style={{ color: t.ink }} accessibilityLabel={`${CYCLE_DAY(c.day)}${CYCLE_OF(c.len, c.phase)}`}>
            <Text style={{ fontWeight: '700' }}>{CYCLE_DAY(c.day)}</Text>
            {CYCLE_OF(c.len, c.phase)}
          </Text>
          {waterRetentionPhase(c) ? <Note>{CYCLE_WATER_NOTE}</Note> : null}
          {c.late ? <Hint>{CYCLE_LATE}</Hint> : null}
          {prev && w ? <Hint>{CYCLE_SAME_DAY(shortDate(prev), String(round1(w.weight_kg)))}</Hint> : null}
        </>
      ) : (
        <Hint>{CYCLE_START_HINT}</Hint>
      )}
      <View style={styles.inline}>
        <Field label={CYCLE_DATE_LABEL} placeholder={CYCLE_DATE_PLACEHOLDER} inputMode="numeric" value={text} onChangeText={setText} />
        <Button label={CYCLE_LOG} onPress={() => (validStart(text.trim(), today) ? void cycle.logStart(text.trim()) : notify(CYCLE_DATE_BAD))} />
      </View>
      {d.starts.length ? (
        <>
          <Hint>{CYCLE_LOGGED_LIST(listed)}</Hint>
          <Button label={CYCLE_REMOVE_LAST} kind="link" onPress={() => void cycle.removeLast()} />
        </>
      ) : null}
      <Hint>{CYCLE_PRIVATE}</Hint>
      <Button label={CYCLE_OFF} kind="link" onPress={() => void cycle.turnOffAndDelete()} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 16 },
  inline: { gap: 8 },
});
