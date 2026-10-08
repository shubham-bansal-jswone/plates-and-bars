import { useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ResultsView } from '../components/ResultsView';
import { Button, ErrorText, Field, Choice, Group, H1, Hint, Label, Note, Page, layout } from '../components/ui';
import { ACTIVITY, CONSENT, EXPERIENCE, GOALS, PACES, SCREEN_Q, WHERE } from '../setup/copy';
import { DAY_CHOICES, SESSION_MINUTES, SETUP_STEPS as STEPS } from '@plate-and-bar/core';
import { buildProfile, draftFromProfile, emptyDraft, validateStep, type Draft } from '../setup/logic';
import { useProfile } from '../state/ProfileProvider';
import { useTheme } from '../theme/useTheme';

type Pick = <K extends keyof Draft>(k: K, v: Draft[K]) => void;
const entries = <K extends string>(o: Record<K, readonly [string, string]>) => Object.entries(o) as [K, readonly [string, string]][];

const SAVE_ERROR = 'Could not save on this device. Please try again.';

function Consent({ onContinue }: { onContinue: () => Promise<void> }) {
  const c = useTheme();
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Page>
      <H1>{CONSENT.title}</H1>
      <Text style={{ color: c.ink, lineHeight: 22 }}>{CONSENT.intro}</Text>
      {CONSENT.bullets.map((b) => (
        <Text key={b} style={{ color: c.ink, lineHeight: 22 }}>
          {'•  '}
          {b}
        </Text>
      ))}
      <Note>{CONSENT.note}</Note>
      <View style={[layout.row, { marginTop: 8 }]}>
        <Switch
          accessibilityLabel={CONSENT.checkbox}
          value={ok}
          onValueChange={(v) => {
            setOk(v);
            setErr('');
          }}
        />
        <Pressable accessibilityElementsHidden importantForAccessibility="no" onPress={() => setOk(!ok)} style={{ flex: 1 }}>
          <Text style={{ color: c.ink }}>{CONSENT.checkbox}</Text>
        </Pressable>
      </View>
      {err ? <ErrorText>{err}</ErrorText> : null}
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

function StepBody({ step, d, set }: { step: number; d: Draft; set: Pick }) {
  const c = useTheme();
  if (step === 0)
    return (
      <>
        <H1>Let’s work out your targets</H1>
        <Hint>Four quick steps. You can change any answer later.</Hint>
        <View style={layout.field}>
          <Label>Sex</Label>
          <Group label="Sex">
            <Choice label="Male" selected={d.sex === 'male'} onPress={() => set('sex', 'male')} />
            <Choice label="Female" selected={d.sex === 'female'} onPress={() => set('sex', 'female')} />
          </Group>
          <Hint>Used only for the calorie formula, which differs by sex.</Hint>
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
          <Label>Age</Label>
          <View style={layout.row}>
            <Field label="Age" inputMode="numeric" placeholder="Years" value={d.age} onChangeText={(v) => set('age', v)} />
          </View>
        </View>
        <View style={layout.field}>
          <Label>Height</Label>
          <View style={layout.row}>
            {d.unit === 'ft' ? (
              <>
                <Field label="Height feet" inputMode="numeric" placeholder="ft" value={d.ft} onChangeText={(v) => set('ft', v)} />
                <Field label="Height inches" inputMode="numeric" placeholder="in" value={d.inch} onChangeText={(v) => set('inch', v)} />
                <Button kind="link" label="Use cm" onPress={() => set('unit', 'cm')} />
              </>
            ) : (
              <>
                <Field label="Height in cm" inputMode="numeric" placeholder="cm" value={d.cm} onChangeText={(v) => set('cm', v)} />
                <Button kind="link" label="Use feet and inches" onPress={() => set('unit', 'ft')} />
              </>
            )}
          </View>
        </View>
        <View style={layout.field}>
          <Label>Weight (kg)</Label>
          <View style={layout.row}>
            <Field label="Weight in kg" inputMode="decimal" placeholder="kg" value={d.weight} onChangeText={(v) => set('weight', v)} />
          </View>
        </View>
      </>
    );
  if (step === 1)
    return (
      <>
        <H1>How active is your day, outside the gym?</H1>
        <Hint>Think of a typical weekday. Training comes in the next step.</Hint>
        <Group label="Activity">
          {entries(ACTIVITY).map(([k, [l, s]]) => (
            <Choice key={k} label={l} sub={s} selected={d.activity === k} onPress={() => set('activity', k)} />
          ))}
        </Group>
      </>
    );
  if (step === 2)
    return (
      <>
        <H1>How do you train?</H1>
        <View style={layout.field}>
          <Label>Sessions per week</Label>
          <Group label="Sessions per week">
            <View style={layout.row}>
              {DAY_CHOICES.map((n) => (
                <Choice key={n} chip label={n === 0 ? 'None yet' : String(n)} selected={d.days === n} onPress={() => set('days', n)} />
              ))}
            </View>
          </Group>
        </View>
        {d.days ? (
          <>
            <View style={layout.field}>
              <Label>Where do you train?</Label>
              <Group label="Where do you train?">
                {entries(WHERE).map(([k, [l, s]]) => (
                  <Choice key={k} label={l} sub={s} selected={d.where === k} onPress={() => set('where', k)} />
                ))}
              </Group>
            </View>
            <View style={layout.field}>
              <Label>Training experience</Label>
              <Group label="Training experience">
                {entries(EXPERIENCE).map(([k, [l, s]]) => (
                  <Choice key={k} label={l} sub={s} selected={d.exp === k} onPress={() => set('exp', k)} />
                ))}
              </Group>
            </View>
            <View style={layout.field}>
              <Label>Typical session length</Label>
              <Group label="Typical session length">
                <View style={layout.row}>
                  {SESSION_MINUTES.map((m) => (
                    <Choice key={m} chip label={`${m} min`} selected={d.minutes === m} onPress={() => set('minutes', m)} />
                  ))}
                </View>
              </Group>
            </View>
          </>
        ) : null}
      </>
    );
  return (
    <>
      <H1>What’s your main goal?</H1>
      <Group label="Main goal">
        {entries(GOALS).map(([k, [l, s]]) => (
          <Choice key={k} label={l} sub={s} selected={d.goal === k} onPress={() => set('goal', k)} />
        ))}
      </Group>
      <View style={layout.field}>
        <Label>Quick health check</Label>
        {SCREEN_Q.map((q, i) => (
          <View key={q} style={{ gap: 6, marginBottom: 8 }}>
            <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>{q}</Text>
            <Group label={q}>
              <View style={layout.row}>
                {(['no', 'yes'] as const).map((a) => (
                  <Choice
                    key={a}
                    chip
                    label={a === 'no' ? 'No' : 'Yes'}
                    selected={d.screen[i] === a}
                    onPress={() => set('screen', d.screen.map((x, j) => (j === i ? a : x)))}
                  />
                ))}
              </View>
            </Group>
          </View>
        ))}
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
  const { status } = useProfile();
  // Wait for the stored profile, so a redo starts from its answers.
  return status === 'ready' ? <SetupFlow recalc={recalc} /> : null;
}

/**
 * With a stored profile (redo), the form starts with its answers, and `recalc` opens straight on the results
 * (prototype `su-recalc`, `startSetup(4)`); saving keeps the profile's `created` and `cleared`.
 */
function SetupFlow({ recalc }: { recalc: boolean }) {
  const { profile: stored, consent, giveConsent, setProfile, skipSetup } = useProfile();
  const router = useRouter();
  const c = useTheme();
  const [d, setD] = useState<Draft>(() => (stored ? draftFromProfile(stored) : emptyDraft()));
  const [step, setStep] = useState(stored && recalc ? STEPS : 0);
  const [err, setErr] = useState('');
  const set: Pick = (k, v) => {
    setErr('');
    setD((prev) => ({ ...prev, [k]: v }));
  };
  const profile = useMemo(() => (step === STEPS ? buildProfile(d, new Date(), stored) : null), [step, d, stored]);

  if (!consent) return <Consent onContinue={giveConsent} />;

  const next = () => {
    const e = validateStep(step, d);
    setErr(e);
    if (!e) setStep(step + 1);
  };
  return (
    <Page>
      <View style={[layout.row, { justifyContent: 'space-between' }]}>
        {step > 0 ? (
          <Button
            kind="link"
            label="‹ Back"
            onPress={() => {
              setErr('');
              setStep(step - 1);
            }}
          />
        ) : (
          <View />
        )}
        <Text style={{ color: c.muted }}>{step < STEPS ? `Step ${step + 1} of ${STEPS}` : 'Your targets'}</Text>
        <Button
          kind="link"
          label="Skip for now"
          onPress={() => {
            skipSetup();
            router.replace('/' as never);
          }}
        />
      </View>
      {profile ? (
        <>
          <ResultsView profile={profile} />
          {err ? <ErrorText>{err}</ErrorText> : null}
          <Button
            label="Use these targets"
            onPress={async () => {
              try {
                await setProfile(profile);
              } catch {
                setErr(SAVE_ERROR);
                return;
              }
              router.replace('/targets' as never);
            }}
          />
        </>
      ) : (
        <>
          <StepBody step={step} d={d} set={set} />
          {err ? <ErrorText>{err}</ErrorText> : null}
          <Button label={step === STEPS - 1 ? 'See my targets' : 'Continue'} onPress={next} />
        </>
      )}
    </Page>
  );
}
