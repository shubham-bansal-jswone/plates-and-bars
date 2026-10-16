import { useEffect, useState, type ReactNode } from 'react';
import { WhyLink } from '../why/WhyLink';
import { StyleSheet, View } from 'react-native';
import { Input } from '../components/Input';
import { radius } from '../theme/tokens';
import { Text } from '../components/Text';
import { feelResult, isFocus, showFeel, rampTickFill, kgLabel, noLoad, repWord, restLabel, setTarget, type ExInfo, type Rate, type Suggestion, type WarmupSet } from '@plate-and-bar/core';
import { a11yState, Heading, Button, Card, Hint, Note, Press } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from './catalog';
import { RATE_LABEL, RATE_ORDER, TYPE_LABEL, listJoin, muscleName } from './copy';
import type { ExState, Row } from './model';
import { Chip } from './parts';

const r1 = (n: number | string): number => Math.round(Number(n) * 10) / 10;

export interface Actions {
  edit(kind: 'work' | 'ramp', j: number, field: 'w' | 'r', v: string): void;
  tick(j: number): void;
  rate(j: number, v: Rate | null): void;
  form(v: 'yes' | 'no' | null): void;
  /** The answer to "Where did you feel that set most?": 'target', 'pain' or a `misplaced_feel` index. */
  feel(v: string): void;
  /** After "It hurt": drop the sets not done yet. */
  skipRest(): void;
  rampStart(): void;
  rampSkip(): void;
  rampAdd(): void;
  rampTick(j: number): void;
  rampRate(j: number, v: Rate | null): void;
  howTo(): void;
  /** Open the "Can't do" sheet for this exercise. */
  cant(): void;
  /** The same sheet, opened with the reason already "pain" (after "It hurt"). */
  cantPain(): void;
  addSet(): void;
  removeSet(): void;
  /** Take this exercise out of today's session. */
  remove(): void;
}

interface Props {
  ex: ExState;
  info: ExInfo;
  sug: Suggestion;
  focus: readonly string[];
  /** Core's warm-up sets for this exercise, or null when no warm-up line shows. */
  warm: [WarmupSet, WarmupSet] | null;
  act: Actions;
  /** Stall and ladder cards, shown under the warm-up line. */
  cards?: ReactNode;
  /** Learn mode (core's `isLearning`): the feel question shows once a set is done. */
  learning?: boolean;
  /** Earlier sessions of this exercise (core's `priorSessions`): the Setup steps start open on the very first one. */
  prior?: number;
}

function RateRow({ row, label, onRate }: { row: Row; label: string; onRate: (v: Rate | null) => void }) {
  const c = useTheme();
  if (!row.done) return null;
  if (row.rate)
    return <Chip label={`${label} rated ${RATE_LABEL[row.rate]}. Change rating`} text={RATE_LABEL[row.rate]} pressed onPress={() => onRate(null)} />;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>How did that feel?</Text>
      <WhyLink id="rir" />
      <View style={styles.wrap}>
        {RATE_ORDER.map((k) => (
          <Chip key={k} label={`${label}: ${RATE_LABEL[k]}`} text={RATE_LABEL[k]} onPress={() => onRate(k)} />
        ))}
      </View>
    </View>
  );
}

function SetRow({ n, label, row, wHead, repsHead, ph, onEdit, onTick, nl }: { n: string; label: string; row: Row; wHead: string; repsHead: string; ph: { w: string; r: string }; onEdit(f: 'w' | 'r', v: string): void; onTick(): void; nl: boolean }) {
  const c = useTheme();
  return (
    <View style={styles.set}>
      <Text style={{ color: c.muted, width: 28, fontWeight: '700' }}>{n}</Text>
      <Input accessibilityLabel={`${label} ${wHead}`} inputMode="decimal" value={row.w} placeholder={ph.w} onChangeText={(v) => onEdit('w', v)} style={styles.input} />
      <Input accessibilityLabel={`${label} ${repsHead}`} inputMode="numeric" value={row.r} placeholder={ph.r} onChangeText={(v) => onEdit('r', v)} style={styles.input} />
      <Press
        accessibilityRole="checkbox"
        accessibilityLabel={`Mark ${label} done`}
        {...a11yState({ checked: row.done })}
        onPress={onTick}
        style={[styles.tick, { borderColor: c.brand, backgroundColor: row.done ? c.brand : c.surface }]}
      >
        <Text style={{ color: row.done ? c.onBrand : c.link, fontWeight: '700', fontSize: 18 }}>✓</Text>
      </Press>
    </View>
  );
}

/** "Where did you feel that set most?" and what each answer shows (prototype `feelHtml`; the rule is core's `feelResult`). */
function FeelStep({ ex, act }: { ex: ExState; act: Actions }) {
  const c = useTheme();
  const card = getCatalog().cards[ex.name];
  if (!card) return null;
  const r = feelResult(ex.feel, card.misplaced_feel);
  if (r.kind === 'target') return <Hint>Felt it in the right place. Good.</Hint>;
  if (r.kind === 'elsewhere') return r.fix ? <Note><Text style={{ fontWeight: '700' }}>Try this: </Text>{r.fix}</Note> : null;
  if (r.kind === 'pain')
    return (
      <View style={{ gap: 8 }}>
        <View style={{ borderLeftWidth: 3, borderLeftColor: c.danger, borderRadius: radius.md }}>
          <Note>
            <Text style={{ fontWeight: '700' }}>Stop this exercise for today.</Text> Pain is different from muscle effort or burning. If it happens again next session, pick a different exercise, and see a physio if it keeps happening.
          </Note>
        </View>
        <View style={styles.wrap}>
          <Button label="Find an alternative" a11yLabel={`Find an alternative to ${ex.name}`} onPress={act.cantPain} />
          {ex.sets.some((s) => !s.done) ? <Button label="Skip remaining sets" a11yLabel={`Skip remaining sets of ${ex.name}`} kind="ghost" onPress={act.skipRest} /> : null}
        </View>
      </View>
    );
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>Where did you feel that set most?</Text>
      <View style={styles.wrap}>
        <Chip label={`${ex.name} felt: ${card.where_to_feel.split(',')[0]}`} text={card.where_to_feel.split(',')[0] ?? ''} onPress={() => act.feel('target')} />
        {card.misplaced_feel.map(([area], k) => (
          <Chip key={k} label={`${ex.name} felt: ${area}`} text={area} onPress={() => act.feel(String(k))} />
        ))}
        <Chip label={`${ex.name}: It hurt`} text="It hurt" danger onPress={() => act.feel('pain')} />
      </View>
    </View>
  );
}

/** The Learn mode block (prototype `learnHtml`): the tag, the Setup steps (open on the very first session) and the cue for the set about to be done. Demo images are left out until their source is settled (#623). */
function LearnBlock({ ex, first, done }: { ex: ExState; first: boolean; done: number }) {
  const c = useTheme();
  const [shown, setShown] = useState<boolean | null>(null); // null until the user toggles it
  const card = getCatalog().cards[ex.name];
  if (!card) return null;
  const open = shown ?? first;
  const cue = card.key_cues[done % card.key_cues.length];
  return (
    <View style={[styles.learn, { borderColor: c.brand }]}>
      <Text style={{ color: c.link, fontSize: 12, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' }}>Learn mode</Text>
      <Button label="Setup" a11yLabel={`Setup steps for ${ex.name}`} kind="link" expanded={open} onPress={() => setShown(!open)} />
      {open ? (
        <View style={{ gap: 3 }}>
          {card.setup.map((x, k) => (
            <Text key={k} style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}>{k + 1}. {x}</Text>
          ))}
        </View>
      ) : null}
      <Text style={{ color: c.ink, fontSize: 15, lineHeight: 21 }}><Text style={{ fontWeight: '700' }}>Focus this set:</Text> {cue}</Text>
    </View>
  );
}

/** One exercise: suggestion, warm-up line, ramp or working sets, ratings and the form question. */
export function ExerciseCard({ ex, info, sug, focus, warm, act, cards, learning, prior }: Props) {
  const [armed, setArmed] = useState(false); // removing an exercise takes a second tap: its logged sets go with it
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000); // a stray tap much later must not remove it
    return () => clearTimeout(t);
  }, [armed]);
  const c = useTheme();
  const nl = noLoad(info.type);
  const rw = repWord(info.type);
  const wHead = info.type === 'dumbbell' ? 'kg each' : info.type === 'assisted' ? 'Assist kg' : nl ? '+kg' : 'kg';
  const tag = getCatalog().tags[ex.name];
  const working = ex.sets.some((s) => s.done);
  const doneCount = ex.sets.filter((s) => s.done).length;
  const allDone = ex.sets.length > 0 && ex.sets.every((s) => s.done);
  const showRamp = sug.mode === 'new' && !working && !ex.skipRamp;
  // Ramp placeholders and the first ramp set's reps come from core's `rampTickFill`.
  const rampPh = (j: number) => {
    const f = rampTickFill(ex.ramp, j, info);
    return { w: f.w || 'kg', r: f.r };
  };
  const firstRampReps = rampTickFill([{ w: '', r: '', done: false }], 0, info).r;

  return (
    <Card>
      <Heading level={2} style={{ color: c.ink, fontWeight: '600', fontSize: 18 }}>
        {ex.name}
      </Heading>
      <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
        {TYPE_LABEL[info.type]}, {info.lo}–{info.hi} {rw}
        {!nl && info.step ? `, steps of ${r1(info.step)} kg` : ''}
        {'\n'}Rest {restLabel(ex.name, getCatalog().tags)} between sets{ex.bridge ? '\nBridge: a lighter version after your new exercise' : ''}
      </Text>
      <WhyLink id="rest" subject={ex.name} />
      {tag ? (
        <Text style={{ color: c.ink, fontSize: 14 }}>
          {isFocus(ex.name, focus, getCatalog().tags) ? <Text accessibilityLabel="Focus muscle exercise" style={{ color: c.link, fontWeight: '700' }}>Focus </Text> : null}
          <Text style={{ fontWeight: '700' }}>Works: </Text>
          {listJoin(tag.primary.map((m) => muscleName(m)))}
          {tag.secondary.length ? <Text style={{ color: c.muted }}>, plus {listJoin(tag.secondary.map((m) => muscleName(m)))}</Text> : null}
        </Text>
      ) : null}
      <View style={styles.wrap}>
        <Button label={`How to do ${ex.name}`} kind="link" onPress={act.howTo} />
        <Button label={`Can’t do ${ex.name}`} kind="link" onPress={act.cant} />
      </View>
      {learning && doneCount < ex.sets.length ? <LearnBlock ex={ex} first={prior === 0 && doneCount === 0} done={doneCount} /> : null}

      {showRamp ? (
        <View style={[styles.guide, { backgroundColor: c.tint, borderColor: c.line }]}>
          <Text style={{ color: c.ink, fontWeight: '700' }}>First time: find your weight</Text>
          {ex.ramp.length === 0 ? (
            <>
              <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>
                1. Do {firstRampReps} easy reps with a light weight to learn the movement.{'\n'}2. Add a step and do {info.lo} reps. Rate how it felt.{'\n'}3. Keep adding until {info.lo} reps feel hard but doable, with 2–3 left in the tank.
              </Text>
              <View style={styles.wrap}>
                <Button label={`Start the ramp for ${ex.name}`} onPress={act.rampStart} />
                <Button label={`I know my weight for ${ex.name}`} kind="ghost" onPress={act.rampSkip} />
              </View>
            </>
          ) : (
            <>
              <Hint>These don’t count as working sets.</Hint>
              {ex.ramp.map((s, j) => (
                <View key={s.id} style={{ gap: 6 }}>
                  <SetRow n={`R${j + 1}`} label={`${ex.name} ramp set ${j + 1}`} row={s} wHead="weight" repsHead="reps" ph={rampPh(j)} nl={nl} onEdit={(f, v) => act.edit('ramp', j, f, v)} onTick={() => act.rampTick(j)} />
                  <RateRow row={s} label={`${ex.name} ramp set ${j + 1}`} onRate={(v) => act.rampRate(j, v)} />
                </View>
              ))}
              {ex.found !== null ? (
                <Text style={{ color: c.ink, fontSize: 14 }}>
                  Working weight found: <Text style={{ fontWeight: '700' }}>{kgLabel(ex.found, info)}</Text>. Your working sets below start there.
                </Text>
              ) : (
                <Button label={`Add ramp set for ${ex.name}`} kind="ghost" onPress={act.rampAdd} />
              )}
            </>
          )}
        </View>
      ) : sug.reason ? (
        <View style={[styles.guide, { backgroundColor: c.tint, borderColor: c.line }]}>
          <Text style={{ color: c.ink, fontWeight: '700' }}>Suggested: {sug.text}</Text>
          <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>{sug.reason}</Text>
          <WhyLink id="progression" />
        </View>
      ) : null}
      {warm ? (
        <View>
          <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
            <Text style={{ fontWeight: '700', color: c.ink }}>Warm up first: </Text>{warm[0].reps} reps at {kgLabel(warm[0].w, info)}, then {warm[1].reps} at {kgLabel(warm[1].w, info)}. Not logged.
          </Text>
          <WhyLink id="warmup" subject={ex.name} />
        </View>
      ) : null}
      {cards}

      <View style={{ gap: 6 }}>
        {ex.sets.map((s, j) => {
          const t = setTarget(ex.sets, j, sug, info, ex.found);
          const label = `${ex.name} set ${j + 1}`;
          return (
            <View key={s.id} style={{ gap: 6 }}>
              <SetRow n={String(j + 1)} label={label} row={s} wHead={wHead} repsHead={rw} nl={nl} ph={{ w: t.w !== '' && t.w !== undefined ? String(r1(t.w)) : nl ? 'BW' : '–', r: t.r ? String(t.r) : '–' }} onEdit={(f, v) => act.edit('work', j, f, v)} onTick={() => act.tick(j)} />
              <RateRow row={s} label={label} onRate={(v) => act.rate(j, v)} />
            </View>
          );
        })}
      </View>

      {showFeel(!!learning, working) ? <FeelStep ex={ex} act={act} /> : null}

      {allDone && !nl ? (
        ex.form ? (
          <Text style={{ color: c.muted, fontSize: 14 }}>
            Form: {ex.form === 'yes' ? 'stayed solid' : 'slipped, so the weight won’t go up next time'}.
          </Text>
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={{ color: c.muted, fontSize: 14 }}>Did your form stay solid on every set?</Text>
            <View style={styles.wrap}>
              <Chip label={`${ex.name} form: Yes`} text="Yes" onPress={() => act.form('yes')} />
              <Chip label={`${ex.name} form: Not really`} text="Not really" onPress={() => act.form('no')} />
            </View>
          </View>
        )
      ) : null}
      {allDone && !nl && ex.form ? <Button label={`Change form answer for ${ex.name}`} kind="link" onPress={() => act.form(null)} /> : null}
      <View style={styles.setRow}>
        <Chip label={`Add a set to ${ex.name}`} text="Add set" onPress={act.addSet} />
        {ex.sets.length > 1 ? <Chip label={`Remove the last set of ${ex.name}`} text="Remove last set" onPress={act.removeSet} /> : null}
        <Chip
          label={armed ? `Tap again to remove ${ex.name} from today` : `Remove ${ex.name} from today`}
          text={armed ? 'Tap again to remove' : 'Remove exercise'}
          onPress={() => (armed ? act.remove() : setArmed(true))}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  setRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  learn: { borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', padding: 10, gap: 6 },
  guide: { borderRadius: radius.md, borderWidth: 1, padding: 10, gap: 6 },
  set: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 60 },
  tick: { width: 48, height: 48, borderWidth: 2, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
