import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { mondayOf, type WeekPlan } from '@plate-and-bar/core';
import { Button, Disclosure, Hint } from '../components/ui';
import { useSettings } from '../state/SettingsProvider';
import { SETTINGS_UNREADABLE } from '../progress/copy';
import { Chip } from './parts';
import { fixedWeekdays, weekPlanFor } from './adjust';

/** "Fewer days this week?" and the note while a condensed week runs (prototype `renderStart`, schedule tools). */
export function WeekTools({ date, notify }: { date: string; notify: (msg: string) => void }) {
  const { settings, update, loadFailed } = useSettings();
  const [open, setOpen] = useState(false);
  const wp = settings.adjustments.weekPlan as WeekPlan | undefined;
  const set = (n: 0 | 3 | 4 | 5) => {
    if (loadFailed || !update((s) => ({ adjustments: weekPlanFor(s.adjustments, date, n) }))) return void notify(SETTINGS_UNREADABLE);
    setOpen(false);
    if (n) notify(`${n}-day plan for this week`);
  };
  if (wp && wp.start === mondayOf(date))
    return (
      <View style={styles.row}>
        <Hint>This week: {wp.list.length}-day plan.</Hint>
        <Button label="Back to the normal week" kind="link" onPress={() => set(0)} />
      </View>
    );
  return (
    <Disclosure label="Fewer days this week?" open={open} onOpenChange={setOpen}>
      <View style={styles.row}>
        {([3, 4, 5] as const).map((n) => (
          <Chip key={n} label={`${n} days`} onPress={() => set(n)} />
        ))}
      </View>
      <Hint>A condensed plan for this week only, then back to normal.</Hint>
    </Disclosure>
  );
}

/** The note in sequence mode, with the way back to weekdays. */
export function ModeNote({ notify }: { notify: (msg: string) => void }) {
  const { settings, update, loadFailed } = useSettings();
  if (settings.adjustments.mode !== 'sequence') return null;
  return (
    <View style={styles.row}>
      <Hint>Your plan runs in order, not by weekday.</Hint>
      <Button label="Go back to fixed weekdays" kind="link" onPress={() => (loadFailed || !update((s) => ({ adjustments: fixedWeekdays(s.adjustments) }))) && notify(SETTINGS_UNREADABLE)} />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 } });
