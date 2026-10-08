import { StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { isFocus, rampTickFill, kgLabel, noLoad, repWord, restLabel, setTarget, type ExInfo, type Rate, type Suggestion, type WarmupSet } from '@plate-and-bar/core';
import { Button, Hint } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { catalog } from './catalog';
import { MUSCLE, RATE_LABEL, RATE_ORDER, TYPE_LABEL, listJoin } from './copy';
import type { ExState, Row } from './model';
import { Card, Chip } from './parts';

const r1 = (n: number | string): number => Math.round(Number(n) * 10) / 10;

export interface Actions {
  edit(kind: 'work' | 'ramp', j: number, field: 'w' | 'r', v: string): void;
  tick(j: number): void;
  rate(j: number, v: Rate | null): void;
  form(v: 'yes' | 'no' | null): void;
  rampStart(): void;
  rampSkip(): void;
  rampAdd(): void;
  rampTick(j: number): void;
  rampRate(j: number, v: Rate | null): void;
  howTo(): void;
}

interface Props {
  ex: ExState;
  info: ExInfo;
  sug: Suggestion;
  focus: readonly string[];
  /** Core's warm-up sets for this exercise, or null when no warm-up line shows. */
  warm: [WarmupSet, WarmupSet] | null;
  act: Actions;
}

function RateRow({ row, label, onRate }: { row: Row; label: string; onRate: (v: Rate | null) => void }) {
  const c = useTheme();
  if (!row.done) return null;
  if (row.rate)
    return <Chip label={`${label} rated ${RATE_LABEL[row.rate]}. Change rating`} text={RATE_LABEL[row.rate]} pressed onPress={() => onRate(null)} />;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.muted, fontSize: 14 }}>How did that feel?</Text>
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
  const input = { color: c.ink, borderColor: c.line, backgroundColor: c.surface };
  return (
    <View style={styles.set}>
      <Text style={{ color: c.muted, width: 28, fontWeight: '700' }}>{n}</Text>
      <TextInput accessibilityLabel={`${label} ${wHead}`} inputMode="decimal" value={row.w} placeholder={ph.w} placeholderTextColor={c.muted} onChangeText={(v) => onEdit('w', v)} style={[styles.input, input]} />
      <TextInput accessibilityLabel={`${label} ${repsHead}`} inputMode="numeric" value={row.r} placeholder={ph.r} placeholderTextColor={c.muted} onChangeText={(v) => onEdit('r', v)} style={[styles.input, input]} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Mark ${label} done`}
        accessibilityState={{ checked: row.done }}
        aria-checked={row.done}
        onPress={onTick}
        style={[styles.tick, { borderColor: c.brand, backgroundColor: row.done ? c.brand : c.surface }]}
      >
        <Text style={{ color: row.done ? c.onBrand : c.brand, fontWeight: '800', fontSize: 18 }}>✓</Text>
      </Pressable>
    </View>
  );
}

/** One exercise: suggestion, warm-up line, ramp or working sets, ratings and the form question. */
export function ExerciseCard({ ex, info, sug, focus, warm, act }: Props) {
  const c = useTheme();
  const nl = noLoad(info.type);
  const rw = repWord(info.type);
  const wHead = info.type === 'dumbbell' ? 'kg each' : info.type === 'assisted' ? 'Assist kg' : nl ? '+kg' : 'kg';
  const tag = catalog.tags[ex.name];
  const working = ex.sets.some((s) => s.done);
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
      <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '800', fontSize: 18 }}>
        {ex.name}
      </Text>
      <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
        {TYPE_LABEL[info.type]}, {info.lo}–{info.hi} {rw}
        {!nl && info.step ? `, steps of ${r1(info.step)} kg` : ''}
        {'\n'}Rest {restLabel(ex.name, catalog.tags)} between sets{ex.bridge ? '\nBridge: a lighter version after your new exercise' : ''}
      </Text>
      {tag ? (
        <Text style={{ color: c.ink, fontSize: 14 }}>
          {isFocus(ex.name, focus, catalog.tags) ? <Text accessibilityLabel="Focus muscle exercise" style={{ color: c.brand, fontWeight: '800' }}>Focus </Text> : null}
          <Text style={{ fontWeight: '700' }}>Works: </Text>
          {listJoin(tag.primary.map((m) => MUSCLE[m] ?? m))}
          {tag.secondary.length ? <Text style={{ color: c.muted }}>, plus {listJoin(tag.secondary.map((m) => MUSCLE[m] ?? m))}</Text> : null}
        </Text>
      ) : null}
      <View style={styles.wrap}>
        <Button label={`How to do ${ex.name}`} kind="link" onPress={act.howTo} />
      </View>

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
        </View>
      ) : null}
      {warm ? (
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
          <Text style={{ fontWeight: '700', color: c.ink }}>Warm up first: </Text>{warm[0].reps} reps at {kgLabel(warm[0].w, info)}, then {warm[1].reps} at {kgLabel(warm[1].w, info)}. Not logged.
        </Text>
      ) : null}

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
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  guide: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 6 },
  set: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 60, minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 16 },
  tick: { width: 48, height: 48, borderWidth: 2, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
