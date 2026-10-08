import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ResultsView } from '../components/ResultsView';
import { Button, ErrorText, H1, Hint, Label, Page } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { targetsRules, type TargetsRules } from '../targets/rules';
import { CoverageSection, FocusSection } from '../targets/sections';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

interface Props {
  db: WorkoutDb;
  /** Core's focus and coverage rules; null until they exist (#148). Injectable for tests. */
  rules?: TargetsRules | null;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/** Targets tab: the stored setup's targets, focus muscles and coverage, and the workout settings. */
export function TargetsScreen({ db, rules = targetsRules, now = () => new Date() }: Props) {
  const { profile, markCleared } = useProfile();
  const { ready, settings, saveFailed, setFocus, setRestOff } = useSettings();
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

  if (!profile) {
    return (
      <Page>
        <H1>Your setup</H1>
        <Hint>Answer a few questions and the app works out your calorie burn and targets.</Hint>
        <Button label="Start setup" onPress={() => router.push('/setup' as never)} />
      </Page>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <Page>
        <ResultsView profile={profile} onCleared={profile.cleared ? undefined : markCleared} />
        <Button label="Recalculate targets" onPress={() => router.push('/setup?recalc=1' as never)} />
        <Button label="Redo setup" kind="ghost" onPress={() => router.push('/setup' as never)} />
        {ready && rules ? (
          <>
            <FocusSection rules={rules} focus={settings.focus} onChange={setFocus} notify={notify} />
            <CoverageSection rules={rules} db={db} profile={profile} settings={settings} today={localDate(now())} />
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
                trackColor={{ true: c.brand, false: c.line }}
              />
              <Text style={{ color: c.ink, flex: 1, fontSize: 16 }}>Start a rest timer after each set</Text>
            </View>
            {saveFailed ? <ErrorText>Couldn’t save that on this device. Try again.</ErrorText> : null}
          </View>
        ) : null}
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}
