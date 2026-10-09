import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect, useRouter } from 'expo-router';
import { weightDrift, type WeekPlan } from '@plate-and-bar/core';
import { loadWeights } from '../db/progress';
import { ResultsView } from '../components/ResultsView';
import { Button, ErrorText, H1, Hint, Label, Note, Page, Switch, Press } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { RulesSection } from '../targets/RulesSection';
import { CoverageSection, FocusSection } from '../targets/sections';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/** Targets tab: the stored setup's targets, focus muscles and coverage, and the workout settings. */
export function TargetsScreen({ db, now = () => new Date() }: Props) {
  const { profile, markCleared } = useProfile();
  const { ready, settings, saveFailed, loadFailed, setFocus, setRestOff } = useSettings();
  const router = useRouter();
  const c = useTheme();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Tab screens stay mounted, so the weigh-ins are read again each time the tab is shown.
  const [weights, setWeights] = useState<Awaited<ReturnType<typeof loadWeights>>>([]);
  const [shown, setShown] = useState(0);
  useFocusEffect(useCallback(() => setShown((n) => n + 1), []));
  useEffect(() => {
    let live = true;
    loadWeights(db).then((w) => live && setWeights(w)).catch(() => {});
    return () => {
      live = false;
    };
  }, [db, shown]);

  if (!profile) {
    return (
      <Page>
        <H1>Your setup</H1>
        <Hint>Answer a few questions and the app works out your calorie burn and targets.</Hint>
        <Button label="Start setup" onPress={() => router.push('/setup' as never)} />
      </Page>
    );
  }
  const drift = weightDrift(weights, profile.weight_kg);
  return (
    <View style={{ flex: 1 }}>
      <Page>
        <ResultsView profile={profile} onCleared={profile.cleared ? undefined : markCleared} />
        {drift ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Note>{`Your latest weight is ${r1(drift.latest)} kg, ${r1(drift.diff)} kg ${drift.lower ? 'lower' : 'higher'} than at setup. Recalculate your targets?`}</Note>
            <Button label="Recalculate targets" onPress={() => router.push('/setup?recalc=1' as never)} />
          </View>
        ) : null}
        <Button label="Redo setup" kind="ghost" onPress={() => router.push('/setup?redo=1' as never)} />
        {ready ? (
          <>
            <RulesSection db={db} today={localDate(now())} now={now} notify={notify} profile={profile} weekPlan={settings.adjustments.weekPlan as WeekPlan | undefined} />
            <FocusSection focus={settings.focus} onChange={setFocus} notify={notify} />
            <CoverageSection db={db} profile={profile} settings={settings} today={localDate(now())} />
          </>
        ) : null}
        {ready ? (
          <View style={{ gap: 8, marginTop: 16 }}>
            <Label>Workout</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Switch
                accessibilityLabel="Start a rest timer after each set"
                value={!settings.rest_off}
                onValueChange={(on) => setRestOff(!on)}
              />
              {/* The text toggles the switch too, as the prototype's label does; the switch carries the spoken name. */}
              <Press focusable={false} accessibilityElementsHidden importantForAccessibility="no" onPress={() => setRestOff(!settings.rest_off)} style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 16 }}>Start a rest timer after each set</Text>
              </Press>
            </View>
            {loadFailed ? <ErrorText>Couldn’t read your saved settings, so changes are not saved. Restart the app to try again.</ErrorText> : null}
            {saveFailed ? <ErrorText>Couldn’t save that on this device. Try again.</ErrorText> : null}
          </View>
        ) : null}
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}
