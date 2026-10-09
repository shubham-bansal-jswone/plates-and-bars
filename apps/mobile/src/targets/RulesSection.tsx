import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { activeRules, cantRule, plannedCoverage, type CantDraft, type LiftRecord, type WeekPlan } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, ErrorText, Hint, Label } from '../components/ui';
import type { ExclusionRecord } from '../db/rules';
import { loadLifts, type WorkoutDb } from '../db/workouts';
import { shortDate } from '../format';
import type { Profile } from '../setup/types';
import { useDataVersion } from '../sync/useDataVersion';
import { useTheme } from '../theme/useTheme';
import { catalog } from '../workout/catalog';
import { applyCantToStoredDay } from '../workout/cantApply';
import { CantSheet } from '../workout/CantSheet';
import { ruleText } from '../workout/rulesCopy';
import { AvoidPicker } from './AvoidPicker';
import { useRules } from '../workout/useRules';

/**
 * Exercises avoided and swapped (prototype `rulesSectionHtml`): each can be removed, which stores a tombstone, and
 * "Add an exercise to avoid" (prototype `rule-add`) picks one from the library and asks the can't-do questions.
 */
export function RulesSection({ db, today, now, notify, profile, weekPlan }: { db: WorkoutDb; today: string; now: () => Date; notify: (msg: string) => void; profile: Profile; weekPlan?: WeekPlan }) {
  const c = useTheme();
  // Tab screens stay mounted, so the rules are read again each time the tab is shown.
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  const dataVersion = useDataVersion();
  const { rules, addRule, removeRule, removeSwap } = useRules({ db, now, notify, reloadKey: shown + dataVersion });
  const [picking, setPicking] = useState(false);
  const [cant, setCant] = useState<string | null>(null);
  const [lifts, setLifts] = useState<Record<string, LiftRecord>>({});
  // The lifts only feed the replacement suggestions and the "skip it" line, so they are read when the picker opens.
  useEffect(() => {
    if (!picking) return;
    let live = true;
    loadLifts(db).then((l) => live && setLifts(l), () => {});
    return () => {
      live = false;
    };
  }, [db, picking]);
  const active = activeRules(rules.exclusions) as ExclusionRecord[];
  const canAdd = rules.ready && !rules.loadFailed;
  const planned = () => plannedCoverage({ date: today, profile, weekPlan, exclusions: rules.exclusions, swaps: rules.swaps, lifts }, catalog);
  const save = (draft: CantDraft, choice: string | null) => {
    const before = rules.exclusions;
    setCant(null);
    // The rules could not be read: nothing is saved or changed (the store said why).
    if (!addRule(cantRule(draft, choice, today))) return;
    // A wider rule also applies to today's session if it is already built, as the prototype does.
    void applyCantToStoredDay({ db, date: today, now, draft, choice, exclusions: before, fallbackWhere: profile.where, onError: () => notify('Couldn’t update today’s workout. Try again.') });
    notify(choice ? `Swapped in ${choice}` : `${draft.name} removed`);
  };
  return (
    <View style={styles.gap}>
      <Label>Exercises and plan</Label>
      {active.length ? <Hint>Avoiding</Hint> : null}
      {active.map((r) => (
        <View key={r.id} style={styles.row}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 15 }}>{ruleText(r)}</Text>
          <Button
            label="Remove"
            a11yLabel={`Remove ${ruleText(r)}`}
            kind="ghost"
            onPress={() => {
              removeRule(r.id);
              notify('Removed');
            }}
          />
        </View>
      ))}
      {rules.swaps.length ? <Hint>Swapped</Hint> : null}
      {rules.swaps.map((s) => (
        <View key={s.from} style={styles.row}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 15 }}>
            {s.from} → {s.to}
            {s.bridge_until && s.bridge_until >= today ? `, bridge until ${shortDate(s.bridge_until)}` : ''}
          </Text>
          <Button
            label="Undo"
            a11yLabel={`Undo swap of ${s.from}`}
            kind="ghost"
            onPress={() => {
              removeSwap(s.from);
              notify('Swap undone');
            }}
          />
        </View>
      ))}
      {rules.loadFailed ? <ErrorText>Couldn’t read your saved exercise rules, so new ones can’t be added. Restart the app to try again.</ErrorText> : null}
      {canAdd ? <Button label="Add an exercise to avoid" kind="ghost" onPress={() => setPicking(true)} /> : null}
      <AvoidPicker
        visible={picking && !cant}
        onPick={(n) => setCant(n)}
        onClose={() => setPicking(false)}
      />
      <CantSheet
        name={cant}
        noToday
        where={profile.where}
        inSession={[]}
        exclusions={rules.exclusions}
        lifts={lifts}
        setsFor={(m) => planned()[m] ?? 0}
        onPick={(draft, choice) => {
          setPicking(false);
          save(draft, choice);
        }}
        onClose={() => {
          // As in the prototype, Close shuts the whole flow, not just the second sheet.
          setCant(null);
          setPicking(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
