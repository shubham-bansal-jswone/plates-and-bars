import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Input } from '../components/Input';
import { Text } from '../components/Text';
import { Press, a11yState } from '../components/ui';
import { radius, tabular, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import type { Row } from './model';
import { SET_ROW_H, TICK_SIZE } from './setSizes';

/** One set (or ramp set): index, weight and reps inputs, and the 56px tick. Labels are part of the app's test and a11y contract. */
export function SetRow({ n, label, row, wHead, repsHead, ph, onEdit, onTick, current }: { n: string; label: string; row: Row; wHead: string; repsHead: string; ph: { w: string; r: string }; onEdit(f: 'w' | 'r', v: string): void; onTick(): 'w' | 'r' | void; /** The next set to do: its tick is the one lime ring; later undone sets keep a quiet outline. */ current?: boolean }) {
  const c = useTheme();
  const num = [type.metricSm, tabular, styles.input];
  // A tick refused for an empty field: that field is focused and marked invalid until it is edited.
  const [bad, setBad] = useState<'w' | 'r' | null>(null);
  const wRef = useRef<ComponentRef<typeof TextInput>>(null);
  const rRef = useRef<ComponentRef<typeof TextInput>>(null);
  const edit = (f: 'w' | 'r', v: string) => {
    setBad(null);
    onEdit(f, v);
  };
  const tick = () => {
    const empty = onTick();
    setBad(empty ?? null);
    if (empty) (empty === 'w' ? wRef : rRef).current?.focus();
  };
  const invalid = (f: 'w' | 'r') => (bad === f ? { invalid: true, 'aria-invalid': true as const, style: [...num, { borderWidth: 2, paddingHorizontal: 13 }] } : { style: num });
  return (
    <View style={styles.set}>
      <Text style={[type.metricSm, tabular, { color: c.muted, width: 28 }]}>{n}</Text>
      <Input accessibilityLabel={`${label} ${wHead}`} inputMode="decimal" ref={wRef} value={row.w} placeholder={ph.w} onChangeText={(v) => edit('w', v)} {...invalid('w')} />
      <Input accessibilityLabel={`${label} ${repsHead}`} inputMode="numeric" ref={rRef} value={row.r} placeholder={ph.r} onChangeText={(v) => edit('r', v)} {...invalid('r')} />
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
  );
}

const styles = StyleSheet.create({
  set: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: SET_ROW_H },
  input: { flex: 1, minWidth: 60, height: 56, textAlign: 'center', paddingHorizontal: 4 },
  tick: { width: TICK_SIZE, height: TICK_SIZE, borderWidth: 2, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
