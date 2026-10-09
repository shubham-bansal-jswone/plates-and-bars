import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { candidates, cantAfterDuration, cantDefaultScope, cantScopeOptions, type CantDraft, type CantDuration, type Exclusion, type ExclusionReason, type LiftRecord, type Where } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Choice, Group, Hint, Note } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { catalog } from './catalog';
import { MUSCLE, listJoin } from './copy';
import { reasonText, jointLabel } from './reasons';
import { DURATIONS, FAMILY, PATTERN, REASONS } from './rulesCopy';

interface Props {
  /** The exercise the user can't do; null closes the sheet. */
  name: string | null;
  where: Where;
  /** Names in today's session, left out of the suggestions. */
  inSession: readonly string[];
  exclusions: readonly Exclusion[];
  lifts: Readonly<Record<string, LiftRecord>>;
  /** Planned weekly sets for a muscle now, for the "skip it" line. */
  setsFor: (muscle: string) => number;
  /** The pick: an exercise name, or null for "skip it". */
  onPick: (draft: CantDraft, choice: string | null) => void;
  onClose: () => void;
  /** No session is being changed (the avoid picker on Targets), so "Just today" is not offered. */
  noToday?: boolean;
}

type Step = 'why' | 'long' | 'scope' | 'pick';

/** The "Can't do this" sheet (prototype `renderCant`): why, for how long, what to leave out, then a replacement. */
export function CantSheet(p: Props) {
  if (!p.name) return null;
  return <Sheet key={p.name} {...p} name={p.name} />;
}

function Sheet({ name, where, inSession, exclusions, lifts, setsFor, onPick, onClose, noToday }: Props & { name: string }) {
  const c = useTheme();
  const t = catalog.tags[name];
  const [step, setStep] = useState<Step>('why');
  const [reason, setReason] = useState<ExclusionReason | null>(null);
  const [dur, setDur] = useState<CantDuration>('perm');
  const [scope, setScope] = useState<{ scope: CantDraft['scope']; key: string }>({ scope: 'exercise', key: name });

  const draft: CantDraft = { name, reason, dur, scope: scope.scope, key: scope.key };

  // The scope step's options come from core (the family option carries how many exercises share it); only the words are here.
  const scopes = cantScopeOptions(name, catalog.tags).map((o): [NonNullable<CantDraft['scope']>, string, string, string] => {
    if (o.scope === 'family') return [o.scope, o.key, `All ${FAMILY[o.key] ?? o.key}`, `${o.count} exercises`];
    if (o.scope === 'pattern') return [o.scope, o.key, `All ${PATTERN[o.key] ?? o.key}`, 'The whole movement type'];
    if (o.scope === 'joint') return [o.scope, o.key, `Anything that loads the ${jointLabel(o.key)}`, 'Safest choice for pain'];
    return [o.scope, o.key, `Just ${name}`, 'Similar exercises stay in your plan.'];
  });

  const cands = useMemo(
    () =>
      step === 'pick'
        ? candidates(name, { where, rules: [{ scope: scope.scope ?? 'exercise', key: scope.key }], joint: scope.scope === 'joint' ? scope.key : null, pain: reason === 'pain', form: reason === 'form', inSession }, exclusions, lifts, catalog)
        : [],
    [step, name, where, scope, reason, inSession, exclusions, lifts],
  );
  const prim = t ? t.primary : [];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
            Can’t do {name}?
          </Text>
          {step === 'why' ? (
            <>
              <Hint>Why not? This decides what the app suggests instead.</Hint>
              {REASONS.map(([k, l]) => (
                <Choice
                  key={k}
                  label={l}
                  selected={false} action
                  onPress={() => {
                    setReason(k);
                    setScope(cantDefaultScope(name, k, catalog.tags));
                    setStep('long');
                  }}
                />
              ))}
            </>
          ) : null}
          {step === 'long' ? (
            <>
              <Hint>For how long?</Hint>
              {DURATIONS.filter(([k]) => !(noToday && k === 'today')).map(([k, l]) => (
                <Choice
                  key={k}
                  label={l}
                  selected={false} action
                  onPress={() => {
                    setDur(k as CantDuration);
                    const next = cantAfterDuration(name, k as CantDuration, catalog.tags);
                    if (next.scope) setScope(next.scope);
                    setStep(next.asksScope ? 'scope' : 'pick');
                  }}
                />
              ))}
              {reason === 'pain' ? <Note>Pain is a signal to stop, not push through. If it keeps happening or came from an injury, see a physio.</Note> : null}
            </>
          ) : null}
          {step === 'scope' ? (
            <>
              <Hint>What should be left out?</Hint>
              <Group label="What should be left out">
              {scopes.map(([sc, key, label, sub]) => (
                <Choice key={`${sc}:${key}`} label={label} sub={sub} selected={scope.scope === sc && scope.key === key} onPress={() => setScope({ scope: sc, key })} />
              ))}
              </Group>
              <Button label="Continue" onPress={() => setStep('pick')} />
            </>
          ) : null}
          {step === 'pick' ? (
            <>
              <Hint>Pick a replacement. It takes the same slot in your sessions{dur === 'today' ? ' today' : ''}.</Hint>
              {cands.map((x) => (
                <Choice key={x.name} label={x.name} sub={reasonText(x.why)} selected={false} action onPress={() => onPick(draft, x.name)} />
              ))}
              {cands.length === 0 ? <Hint>No good match with these rules. You can skip it instead.</Hint> : null}
              <Choice
                label="Skip it, no replacement"
                sub={prim.length ? `Your ${listJoin(prim.map((m) => MUSCLE[m] ?? m))} would get fewer sets each week (now about ${Math.round(setsFor(prim[0] as string))}).` : 'This exercise is removed.'}
                selected={false} action
                onPress={() => onPick(draft, null)}
              />
            </>
          ) : null}
          <Button label="Close" kind="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 8 },
});
