import { useCallback, useEffect, useRef, useState } from 'react';
import { WhyLink } from '../why/WhyLink';
import { fmt } from '../format';
import { buildResults } from '../setup/results';
import type { Profile } from '../setup/types';
import { View } from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect, useRouter } from 'expo-router';
import { weightDrift, type WeekPlan } from '@plate-and-bar/core';
import { loadKitchenTests } from '../db/kitchenTests';
import { loadWeights } from '../db/progress';
import { listIntro } from '../kitchen/copy';
import { ResultsView } from '../components/ResultsView';
import { Button, ErrorText, H1, Hint, Label, Note, Page, Switch, Press } from '../components/ui';
import type { WorkoutDb } from '../db/workouts';
import { localDate } from '../setup/logic';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { TargetsEditor } from '../targets/TargetsEditor';
import { RulesSection } from '../targets/RulesSection';
import { CoverageSection, FocusSection } from '../targets/sections';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';
import { AiSection } from '../ai/AiSection';
import { MyFoodsSection, WaterSizesSection } from '../targets/WaterAndFoods';

const burnParts = (p: Profile) => {
  const { r } = buildResults(p);
  return { tdee: fmt(r.tdee), bmr: fmt(r.bmr), movement: fmt(r.movement), training: fmt(r.training), digestion: fmt(r.digestion) };
};

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/** Targets tab: the stored setup's targets, focus muscles and coverage, and the workout settings. */
export function TargetsScreen({ db, now = () => new Date() }: Props) {
  const { profile, markCleared, setProfile } = useProfile();
  const { ready, settings, saveFailed, loadFailed, setFocus, setRestOff, update } = useSettings();
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
  // The count of kitchen tests, read again each time the tab is shown; null (no line) until read or when it cannot be.
  const [kitchen, setKitchen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    loadKitchenTests(db).then((t) => live && setKitchen(t.length)).catch(() => {});
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
        <ResultsView profile={profile} onCleared={profile.cleared ? undefined : markCleared} hideTargets />
        <TargetsEditor profile={profile} setProfile={setProfile} now={now} notify={notify} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 }}>
          {/* The numbers are the stored (possibly edited) targets; the burn breakdown is what setup computed. */}
          <WhyLink id="targets" label="Why these numbers?" values={{ kcal: fmt(profile.targets.kcal), protein_g: profile.targets.protein_g, ...burnParts(profile) }} />
          <WhyLink id="protein" label="Why this much protein?" values={{ protein_g: profile.targets.protein_g }} />
        </View>
        {drift ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Note>{`Your latest weight is ${r1(drift.latest)} kg, ${r1(drift.diff)} kg ${drift.lower ? 'lower' : 'higher'} than at setup. Recalculate your targets?`}</Note>
            <Button label="Recalculate targets" onPress={() => router.push('/setup?recalc=1' as never)} />
          </View>
        ) : null}
        <Button label="Redo setup" kind="ghost" onPress={() => router.push('/setup?redo=1' as never)} />
        <Button label="Download or delete my data" kind="ghost" onPress={() => router.push('/data' as never)} />
        <Button label="Exercise library" kind="ghost" onPress={() => router.push('/library' as never)} />
        <Button label="About and sources" kind="ghost" onPress={() => router.push('/about' as never)} />
        {ready ? (
          <>
            <RulesSection db={db} today={localDate(now())} now={now} notify={notify} profile={profile} weekPlan={settings.adjustments.weekPlan as WeekPlan | undefined} />
            <FocusSection focus={settings.focus} onChange={setFocus} notify={notify} />
            <CoverageSection db={db} profile={profile} settings={settings} today={localDate(now())} />
          </>
        ) : null}
        <AiSection />
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
        {ready ? <WaterSizesSection sizes={settings.water_sizes} onChange={(k, ml) => update((s) => ({ water_sizes: { ...s.water_sizes, [k]: ml } }))} /> : null}
        {/* Prototype `ktListHtml`: the kitchen tests section of Targets, after Water sizes and before My foods as there; the list itself is on its own screen. */}
        <View style={{ gap: 8, marginTop: 16 }}>
          <Label>Kitchen tests</Label>
          {kitchen !== null ? <Hint>{listIntro(kitchen)}</Hint> : null}
          <Button label="Kitchen tests" kind="ghost" onPress={() => router.push('/kitchen-test' as never)} />
        </View>
        <MyFoodsSection db={db} notify={notify} />
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}
