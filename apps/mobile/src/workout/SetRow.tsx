import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { WeightUnit } from '@plate-and-bar/core';
import { Input } from '../components/Input';
import { Text } from '../components/Text';
import { ErrorText, Press, a11yState } from '../components/ui';
import { radius, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import type { Row } from './model';
import { LABEL_W_WIDE, SET_ROW_H, TICK_SIZE } from './setSizes';
import { weightFieldText, weightFromField } from './unitText';

/** One set (or ramp set): index, weight and reps inputs, and the 56px tick. Labels are part of the app's test and a11y contract. */
export function SetRow({ n, label, row, wHead, repsHead, ph, onEdit, onTick, current, focusWeight, onFocused, unit = 'kg', locked = false, wide = false }: { n: string; label: string; row: Row; wHead: string; repsHead: string; ph: { w: string; r: string }; onEdit(f: 'w' | 'r', v: string): void; onTick(): 'w' | 'r' | void; /** The next set to do: its tick is the one lime ring; later undone sets keep a quiet outline. */ current?: boolean; /** Focus the weight field when this turns true (the ramp was skipped, so focus is not lost with the button). */ focusWeight?: boolean; /** Called once the weight field was focused, so the request is one-shot. */ onFocused?: () => void; /** The unit the weight field shows and takes (the row stores kg text). */ unit?: WeightUnit; /** The stored unit has not loaded yet: the fields are not editable, so nothing is typed in the wrong unit. */ locked?: boolean; /** A letter label (A1, B2) in a superset: a wider label column, so it stays on one line. */ wide?: boolean }) {
  const c = useTheme();
  const num = [type.metricSm, tabular, styles.input];
  // A tick refused for an empty field: that field is focused and marked invalid until it is edited.
  const [bad, setBad] = useState<'w' | 'r' | null>(null);
  const wRef = useRef<ComponentRef<typeof TextInput>>(null);
  const rRef = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (!focusWeight) return;
    wRef.current?.focus();
    onFocused?.();
  }, [focusWeight]); // eslint-disable-line react-hooks/exhaustive-deps
  // In lb the field shows the typed text while it is edited ("135." must stay), and the row gets the kg of it; only an edited field is written back.
  const [typed, setDraft] = useState<{ unit: WeightUnit; text: string } | null>(null);
  const draft = typed && typed.unit === unit ? typed.text : null; // a draft typed in the other unit is dropped
  const unreadable = draft !== null && draft.trim() !== '' && weightFromField(draft, unit) === null;
  const [refused, setRefused] = useState(false);
  const edit = (f: 'w' | 'r', v: string) => {
    setBad(null);
    setRefused(false);
    if (f === 'w') {
      setDraft({ unit, text: v });
      return onEdit('w', weightFromField(v, unit) ?? '');
    }
    onEdit(f, v);
  };
  const tick = () => {
    if (locked) return;
    // A weight typed in lb that is not a number must not be replaced by the suggestion: the tick is refused until it is fixed.
    if (unreadable) {
      setBad('w');
      setRefused(true);
      wRef.current?.focus();
      return;
    }
    setDraft(null);
    const empty = onTick();
    setBad(empty ?? null);
    if (empty) (empty === 'w' ? wRef : rRef).current?.focus();
  };
  // A weight in lb that is not a number stays on screen, marked, after the field loses focus: a tick is refused while it is there.
  const invalid = (f: 'w' | 'r') => (bad === f || (f === 'w' && unreadable) ? { invalid: true, 'aria-invalid': true as const, style: [...num, { borderWidth: 2, paddingHorizontal: 13 }] } : { style: num });
  return (
    <>
    <View style={styles.set}>
      <Text numberOfLines={1} style={[type.metricSm, tabular, { color: c.muted, width: wide ? LABEL_W_WIDE : 28 }]}>{n}</Text>
      <Input accessibilityLabel={`${label} ${wHead}`} inputMode="decimal" autoCorrect={false} autoCapitalize="none" ref={wRef} editable={!locked} value={locked ? '' : (draft ?? weightFieldText(row.w, unit))} placeholder={ph.w} onChangeText={(v) => edit('w', v)} onBlur={() => (unreadable ? undefined : setDraft(null))} {...invalid('w')} />
      <Input accessibilityLabel={`${label} ${repsHead}`} inputMode="numeric" autoCorrect={false} autoCapitalize="none" editable={!locked} ref={rRef} value={row.r} placeholder={ph.r} onChangeText={(v) => edit('r', v)} {...invalid('r')} />
      <Press
        accessibilityRole="checkbox"
        accessibilityLabel={`Mark ${label} done`}
        {...a11yState({ checked: row.done })}
        onPress={tick}
        style={({ pressed }) => [styles.tick, { borderColor: row.done || current ? c.brand : c.outline, backgroundColor: row.done ? c.brand : c.surface }, pressed && { transform: [{ scale: 0.92 }] }]}
      >
        <Svg width={28} height={28} viewBox="0 0 24 24" aria-hidden>
          <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={row.done ? c.onBrand : current ? c.brand : c.muted} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Press>
    </View>
    {refused ? <ErrorText>Enter the weight as a number, like 135 or 62.5.</ErrorText> : null}
    </>
  );
}

const styles = StyleSheet.create({
  set: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: SET_ROW_H },
  input: { flex: 1, minWidth: 60, height: 56, textAlign: 'center', paddingHorizontal: 4 },
  tick: { width: TICK_SIZE, height: TICK_SIZE, borderWidth: 2, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
