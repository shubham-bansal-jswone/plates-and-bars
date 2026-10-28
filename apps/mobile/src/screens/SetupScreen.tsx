import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { WhyLink } from '../why/WhyLink';
import { View } from 'react-native';
import { Text } from '../components/Text';
import { useRouter } from 'expo-router';
import { ResultsView } from '../components/ResultsView';
import { Button, Caption, Card, ErrorText, Field, Choice, Group, H1, Hint, Label, Note, Page, Switch, layout, Press } from '../components/ui';
import { ACTIVITY, CONSENT, EXPERIENCE, GOALS, PACES, SCREEN_Q, WHERE } from '../setup/copy';
import { DAY_CHOICES, SESSION_MINUTES, SETUP_STEPS as STEPS, type WeightUnit } from '@plate-and-bar/core';
import { LegalLinks } from '../legal/LegalLinks';
import { DeletionNotice } from '../account/DeletionNotice';
import type { Profile } from '../setup/types';
import { answersInKg, buildProfileInUnit, draftFromProfile, emptyDraft, keepStoredHeight, stepErrors, type Draft, type SetupField } from '../setup/logic';
import { useProfile } from '../state/ProfileProvider';
import { WeightUnitSection } from '../settings/WeightUnitSection';
import { useWeightUnit } from '../settings/weightUnit';
import { convertWeightText, weightFieldText } from '../workout/unitText';
import { setSetupLeaving } from '../state/setupExit';
import { postToast } from '../state/pendingToast';
import { useTheme } from '../theme/useTheme';
import { radius } from '../theme/tokens';

type Pick = <K extends keyof Draft>(k: K, v: Draft[K]) => void;
const entries = <K extends string>(o: Record<K, readonly [string, string]>) => Object.entries(o) as [K, readonly [string, string]][];

const SAVE_ERROR = 'Could not save on this device. Please try again.';

function Consent({ onContinue }: { onContinue: () => Promise<void> }) {
  const c = useTheme();
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  // Web drops accessibilityHint, so the error text gets an id and the switch points at it with aria-describedby.
  const errId = `${useId().replace(/:/g, '')}-consent-error`;
  return (
    <Page>
      <H1>{CONSENT.title}</H1>
      <Text style={{ color: c.ink, lineHeight: 22 }}>{CONSENT.intro}</Text>
      <Card>
        {CONSENT.bullets.map((b) => (
          <View key={b} style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={{ color: c.brand, lineHeight: 22 }}>{'•'}</Text>
            <Text style={{ color: c.ink, lineHeight: 22, flex: 1 }}>{b}</Text>
          </View>
        ))}
      </Card>
      <LegalLinks />
      <Note>{CONSENT.note}</Note>
      <View style={[layout.row, { marginTop: 8 }]}>
        <Switch
          accessibilityLabel={CONSENT.checkbox}
          accessibilityHint={err || undefined}
          invalid={!!err}
          describedBy={err ? errId : undefined}
          value={ok}
          onValueChange={(v) => {
            setOk(v);
            setErr('');
          }}
        />
        <Press tabIndex={-1} focusable={false} accessibilityElementsHidden importantForAccessibility="no" onPress={() => {
            setOk(!ok);
            setErr('');
          }} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: c.ink }}>{CONSENT.checkbox}</Text>
        </Press>
      </View>
      {err ? <ErrorText id={errId}>{err}</ErrorText> : null}
      <Button
        label="Continue"
        onPress={() => {
          if (!ok) setErr(CONSENT.needsTick);
          else onContinue().catch(() => setErr(SAVE_ERROR));
        }}
      />
    </Page>
  );
}

type Errs = Partial<Record<SetupField, string>>;
type Focusable = { focus?: () => void } | null;
type Focus = (f: SetupField) => (el: never) => void; // `never`: a TextInput and a View ref both fit

/** Each message in `errs` shown under the field it names, and nowhere else. `focus` registers the element Continue focuses for the first invalid field. */
function StepBody({ step, d, set, answer, errs, focus, unit, onUnit }: { step: number; d: Draft; unit: WeightUnit; onUnit: (from: WeightUnit, to: WeightUnit) => void; set: Pick; answer: (i: number, a: 'no' | 'yes') => void; errs: Errs; focus: Focus }) {
  const c = useTheme();
  const bad = (f: SetupField) => !!errs[f];
  // The inline error is also the invalid field's hint, so focusing the field again reads why it is wrong.
  const hint = (f: SetupField) => errs[f];
  // Web drops accessibilityHint, so the error text gets an id and its field or group points at it with aria-describedby.
  const uid = useId().replace(/:/g, '');
  const errId = (at: SetupField) => `${uid}-${at}-error`;
  const hintId = (at: SetupField) => `${uid}-${at}-hint`;
  const describe = (at: SetupField, ...more: string[]) => [...more, ...(errs[at] ? [errId(at)] : [])].join(' ') || undefined;
  const showErr = (at: SetupField) => (errs[at] ? <ErrorText id={errId(at)}>{errs[at]}</ErrorText> : null);
  if (step === 0)
    return (
      <>
        <H1>Let’s work out your targets</H1>
        <Hint>Four quick steps. You can change any answer later.</Hint>
        <View style={layout.field}>
          <Label>Sex</Label>
          <Group label="Sex" error={hint('sex')} describedBy={describe('sex', hintId('sex'))}>
            <View style={layout.row}>
              <Choice focusRef={focus('sex')} chip label="Male" selected={d.sex === 'male'} onPress={() => set('sex', 'male')} />
              <Choice chip label="Female" selected={d.sex === 'female'} onPress={() => set('sex', 'female')} />
            </View>
          </Group>
          <Hint id={hintId('sex')}>Used only for the calorie formula, which differs by sex.</Hint>
          {showErr('sex')}
        </View>
        {d.sex === 'female' ? (
          <View style={layout.field}>
            <Label>Are you pregnant or breastfeeding?</Label>
            <Group label="Pregnant or breastfeeding">
              <View style={layout.row}>
                <Choice chip label="No" selected={d.special === 'none'} onPress={() => set('special', 'none')} />
                <Choice chip label="Pregnant" selected={d.special === 'pregnant'} onPress={() => set('special', 'pregnant')} />
                <Choice chip label="Breastfeeding" selected={d.special === 'breastfeeding'} onPress={() => set('special', 'breastfeeding')} />
              </View>
            </Group>
          </View>
        ) : null}
        <View style={layout.field}>
          <Caption>Age</Caption>
          <View style={layout.row}>
            <Field ref={focus('age')} label="Age" invalid={bad('age')} accessibilityHint={hint('age')} describedBy={describe('age')} inputMode="numeric" placeholder="Years" value={d.age} onChangeText={(v) => set('age', v)} />
          </View>
          {showErr('age')}
        </View>
        <View style={layout.field}>
          <Label>Height</Label>
          <View style={layout.row}>
            {d.unit === 'ft' ? (
              <>
                <Field ref={focus('height')} label="Height feet" invalid={bad('height')} accessibilityHint={hint('height')} describedBy={describe('height')} inputMode="numeric" placeholder="ft" value={d.ft} onChangeText={(v) => set('ft', v)} />
                <Field label="Height inches" invalid={bad('height')} accessibilityHint={hint('height')} describedBy={describe('height')} inputMode="numeric" placeholder="in" value={d.inch} onChangeText={(v) => set('inch', v)} />
                <Button kind="link" label="Use cm" onPress={() => set('unit', 'cm')} />
              </>
            ) : (
              <>
                <Field ref={focus('height')} label="Height in cm" invalid={bad('height')} accessibilityHint={hint('height')} describedBy={describe('height')} inputMode="numeric" placeholder="cm" value={d.cm} onChangeText={(v) => set('cm', v)} />
                <Button kind="link" label="Use feet and inches" onPress={() => set('unit', 'ft')} />
              </>
            )}
          </View>
          {showErr('height')}
        </View>
        <View style={layout.field}>
          <Caption>{`Weight (${unit})`}</Caption>
          <View style={layout.row}>
            <Field ref={focus('weight')} label={`Weight in ${unit}`} invalid={bad('weight')} accessibilityHint={hint('weight')} describedBy={describe('weight')} inputMode="decimal" placeholder={unit} value={d.weight} onChangeText={(v) => set('weight', v)} />
          </View>
          {showErr('weight')}
          <WeightUnitSection onSwitch={onUnit} />
        </View>
      </>
    );
  if (step === 1)
    return (
      <>
        <H1>How active is your day, outside the gym?</H1>
        <Hint id={hintId('activity')}>Think of a typical weekday. Training comes in the next step.</Hint>
        <Group label="Activity" error={hint('activity')} describedBy={describe('activity', hintId('activity'))}>
          {entries(ACTIVITY).map(([k, [l, s]], i) => (
            <Choice key={k} focusRef={i === 0 ? focus('activity') : undefined} label={l} sub={s} selected={d.activity === k} onPress={() => set('activity', k)} />
          ))}
        </Group>
        {showErr('activity')}
      </>
    );
  if (step === 2)
    return (
      <>
        <H1>How do you train?</H1>
        <View style={layout.field}>
          <Label>Sessions per week</Label>
          <Group label="Sessions per week" error={hint('days')} describedBy={describe('days')}>
            <View style={layout.row}>
              {DAY_CHOICES.map((n) => (
                <Choice key={n} focusRef={n === DAY_CHOICES[0] ? focus('days') : undefined} chip label={n === 0 ? 'None yet' : String(n)} selected={d.days === n} onPress={() => set('days', n)} />
              ))}
            </View>
          </Group>
          {showErr('days')}
        </View>
        {d.days ? (
          <>
            <View style={layout.field}>
              <Label>Where do you train?</Label>
              <Group label="Where do you train?" error={hint('where')} describedBy={describe('where')}>
                {entries(WHERE).map(([k, [l, s]], i) => (
                  <Choice key={k} focusRef={i === 0 ? focus('where') : undefined} label={l} sub={s} selected={d.where === k} onPress={() => set('where', k)} />
                ))}
              </Group>
              {showErr('where')}
            </View>
            <View style={layout.field}>
              <Label>Training experience</Label>
              <Group label="Training experience" error={hint('exp')} describedBy={describe('exp')}>
                {entries(EXPERIENCE).map(([k, [l, s]], i) => (
                  <Choice key={k} focusRef={i === 0 ? focus('exp') : undefined} label={l} sub={s} selected={d.exp === k} onPress={() => set('exp', k)} />
                ))}
              </Group>
              {showErr('exp')}
            </View>
            <View style={layout.field}>
              <Label>Typical session length</Label>
              <Group label="Typical session length" error={hint('minutes')} describedBy={describe('minutes')}>
                <View style={layout.row}>
                  {SESSION_MINUTES.map((m, i) => (
                    <Choice key={m} focusRef={i === 0 ? focus('minutes') : undefined} chip label={`${m} min`} selected={d.minutes === m} onPress={() => set('minutes', m)} />
                  ))}
                </View>
              </Group>
              {showErr('minutes')}
            </View>
          </>
        ) : null}
      </>
    );
  return (
    <>
      <H1>What’s your main goal?</H1>
      <Group label="Main goal" error={hint('goal')} describedBy={describe('goal')}>
        {entries(GOALS).map(([k, [l, s]], i) => (
          <Choice key={k} focusRef={i === 0 ? focus('goal') : undefined} label={l} sub={s} selected={d.goal === k} onPress={() => set('goal', k)} />
        ))}
      </Group>
      {showErr('goal')}
      <View style={layout.field}>
        <Label>Quick health check</Label>
        <WhyLink id="screening" />
        {SCREEN_Q.map((q, i) => (
          <View key={q} style={{ gap: 6, marginBottom: 8 }}>
            <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>{q}</Text>
            <Group label={q} error={d.screen[i] ? undefined : hint('screen')} describedBy={d.screen[i] ? undefined : describe('screen')}>
              <View style={layout.row}>
                {(['no', 'yes'] as const).map((a) => (
                  <Choice
                    key={a}
                    focusRef={a === 'no' && i === d.screen.findIndex((x) => !x) ? focus('screen') : undefined}
                    chip
                    label={a === 'no' ? 'No' : 'Yes'}
                    selected={d.screen[i] === a}
                    onPress={() => answer(i, a)}
                  />
                ))}
              </View>
            </Group>
          </View>
        ))}
        {showErr('screen')}
      </View>
      {d.goal === 'lose' ? (
        <View style={layout.field}>
          <Label>Pace</Label>
          <Group label="Pace">
            {entries(PACES).map(([k, [l, s]]) => (
              <Choice key={k} label={l} sub={s} selected={d.pace === k} onPress={() => set('pace', k)} />
            ))}
          </Group>
        </View>
      ) : null}
    </>
  );
}

/** Consent first, then four question steps, then the results; "Use these targets" saves the profile. */
export function SetupScreen({ recalc = false }: { recalc?: boolean }) {
  const { status, profile, latestWeigh } = useProfile();
  const { ready } = useWeightUnit();
  // `undefined` while reading; null when there is no weigh-in or it could not be read.
  const [weight, setWeight] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    latestWeigh().then((w) => live && setWeight(w), () => live && setWeight(null));
    return () => {
      live = false;
    };
  }, [latestWeigh]);
  // Wait for the stored profile and weigh-ins, so a redo starts from its answers and the latest weight.
  return (
    <>
      <DeletionNotice />
      {status === 'ready' && ready && (weight !== undefined || !profile) ? <SetupFlow recalc={recalc} weight={weight ?? null} /> : null}
    </>
  );
}

/**
 * With a stored profile (redo), the form starts with its answers, and `recalc` opens straight on the results
 * (prototype `su-recalc`, `startSetup(4)`); the latest weigh-in replaces the stored weight, as `startSetup` does; saving keeps the profile's `created` and `cleared`.
 */
function SetupFlow({ recalc, weight }: { recalc: boolean; weight: number | null }) {
  const { profile: stored, consent, giveConsent, saveSetup, skipSetup } = useProfile();
  const router = useRouter();
  const c = useTheme();
  const { unit } = useWeightUnit(); // the box is typed in this unit; the answers go to core in kg (`answersInKg`)
  const [d, setD] = useState<Draft>(() => (stored ? { ...draftFromProfile(stored, unit), ...(weight ? { weight: weightFieldText(String(weight), unit) } : {}) } : emptyDraft()));
  const [step, setStep] = useState(stored && recalc ? STEPS : 0);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState<Errs>({});
  const els = useRef<Partial<Record<SetupField, Focusable>>>({});
  const focus: Focus = (f) => (el) => {
    els.current[f] = el as Focusable;
  };
  const set: Pick = (k, v) => {
    setErr('');
    setErrs({});
    setD((prev) => ({ ...prev, [k]: v }));
  };
  // A functional update, so two answers in one tick both land instead of the later one rebuilding from a stale render (#1232).
  const answer = (i: number, a: 'no' | 'yes') => {
    setErr('');
    setErrs({});
    setD((prev) => ({ ...prev, screen: prev.screen.map((x, j) => (j === i ? a : x)) }));
  };
  const profile = useMemo(() => (step === STEPS ? buildProfileInUnit(answersInKg(stored ? keepStoredHeight(d, stored) : d, unit, stored), new Date(), stored, unit) : null), [step, d, stored, unit]);

  const save = async (p: Profile, toast: string | null) => {
    setSetupLeaving(true);
    try {
      await saveSetup(p);
    } catch {
      setSetupLeaving(false);
      setErr(SAVE_ERROR);
      return;
    }
    if (toast) postToast(toast); // first setup updates nothing, so it says nothing (#1194)
    router.replace('/' as never);
  };

  if (!consent) return <Consent onContinue={giveConsent} />;

  const next = () => {
    const found = stepErrors(step, answersInKg(stored ? keepStoredHeight(d, stored) : d, unit, stored), unit); // an unedited redo checks the stored cm, not the rounded ft/in (#1224)
    setErr('');
    setErrs(Object.fromEntries(found));
    if (!found.length) setStep(step + 1);
    else els.current[found[0]![0]]?.focus?.();
  };
  return (
    <Page resetKey={step} wide={!!profile}>
      <View style={[layout.row, { justifyContent: 'space-between' }]}>
        {step > 0 ? (
          <Button
            kind="link"
            label="‹ Back"
            onPress={() => {
              setErr('');
              setErrs({});
              setStep(step - 1);
            }}
          />
        ) : (
          <View />
        )}
        <Text style={{ color: c.muted }}>{step < STEPS ? `Step ${step + 1} of ${STEPS}` : 'Your targets'}</Text>
        {stored ? (
          <Button kind="link" label="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace('/targets' as never))} />
        ) : (
          <Button
            kind="link"
            label="Skip for now"
            onPress={() => {
              skipSetup();
              router.replace('/' as never);
            }}
          />
        )}
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Setup progress"
        accessibilityValue={{ min: 0, max: STEPS, now: Math.min(step + 1, STEPS) }}
        style={{ flexDirection: 'row', gap: 4 }}
      >
        {Array.from({ length: STEPS }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: radius.full, backgroundColor: i <= step ? c.brand : c.track }} />
        ))}
      </View>
      {profile ? (
        <>
          <ResultsView profile={profile} showWhy columns />
          <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 8 }}>
            {err ? <ErrorText>{err}</ErrorText> : null}
            <Button label="Use these targets" onPress={() => save(profile, stored ? 'Targets updated' : null)} />
            {stored ? <Button kind="ghost" label="Keep my current targets" onPress={() => save({ ...profile, targets: stored.targets }, 'Setup saved, targets unchanged')} /> : null}
          </View>
        </>
      ) : (
        <>
          <StepBody step={step} d={d} set={set} answer={answer} errs={errs} focus={focus} unit={unit} onUnit={(from, to) => setD((prev) => ({ ...prev, weight: convertWeightText(prev.weight, from, to) }))} />
          {err ? <ErrorText>{err}</ErrorText> : null}
          <Button label={step === STEPS - 1 ? 'See my targets' : 'Continue'} onPress={next} />
        </>
      )}
    </Page>
  );
}
