import { useState } from 'react';
import { FlatList, Modal, StyleSheet, View } from 'react-native';
import { UNIT_GRAMS } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { a11yState, Heading, Button, ErrorText, Field, Press } from '../components/ui';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { UNKNOWN_ROW } from './copy';
import { getRawNames, unknownIngredients } from './content';

/** An ingredient row as typed: the amount stays text until core reads it. */
export interface DraftRow {
  ingredient: string;
  amount: string;
  unit: string;
}

export const NEW_ROW: DraftRow = { ingredient: 'Onion', amount: '', unit: 'g' };

const UNITS = Object.keys(UNIT_GRAMS);

/** The ingredient rows of the recipe builder and the kitchen test: pick an ingredient, an amount and a unit (prototype `.rb-row`). */
export function IngredientRows({ rows, onChange, addLabel = '+ Add ingredient', names = getRawNames }: { rows: DraftRow[]; onChange: (rows: DraftRow[]) => void; addLabel?: string; /** The names the picker offers (default: the chosen raw table). */ names?: () => readonly string[] }) {
  const c = useTheme();
  const [picking, setPicking] = useState<number | null>(null);
  const set = (k: number, patch: Partial<DraftRow>) => onChange(rows.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const unknown = new Set(unknownIngredients(rows));
  return (
    <View style={styles.gap}>
      {rows.map((r, k) => (
        <View key={k}>
        <View style={styles.row}>
          <Press accessibilityRole="button" accessibilityLabel={`Ingredient ${k + 1}: ${r.ingredient}${unknown.has(r.ingredient) ? `, ${UNKNOWN_ROW}` : ''}. Tap to change`} onPress={() => setPicking(k)} style={[styles.pick, { borderColor: c.outline, backgroundColor: c.field }]}>
            <Text numberOfLines={2} style={{ color: c.ink }}>{r.ingredient}</Text>
          </Press>
          <Field label={`Amount for ingredient ${k + 1}`} placeholder="0" keyboardType="decimal-pad" value={r.amount} onChangeText={(amount) => set(k, { amount })} />
          <Press
            accessibilityRole="button"
            accessibilityLabel={`Unit for ingredient ${k + 1}: ${r.unit}. Tap to change`}
            onPress={() => set(k, { unit: UNITS[(UNITS.indexOf(r.unit) + 1) % UNITS.length]! })}
            style={[styles.unit, { borderColor: c.outline, backgroundColor: c.field }]}
          >
            <Text style={{ color: c.ink }}>{r.unit}</Text>
          </Press>
          <Press accessibilityRole="button" accessibilityLabel={`Remove ingredient ${k + 1}`} onPress={() => onChange(rows.filter((_, i) => i !== k))} style={styles.x}>
            <Text style={{ color: c.muted, fontSize: 22 }}>×</Text>
          </Press>
        </View>
        {unknown.has(r.ingredient) ? <ErrorText>{`${r.ingredient}: ${UNKNOWN_ROW}`}</ErrorText> : null}
        </View>
      ))}
      <View style={styles.start}><Button label={addLabel} kind="ghost" onPress={() => onChange([...rows, NEW_ROW])} /></View>
      {picking !== null ? <Picker names={names} current={rows[picking]?.ingredient} onPick={(n) => { set(picking, { ingredient: n }); setPicking(null); }} onClose={() => setPicking(null)} /> : null}
    </View>
  );
}

function Picker({ names, current, onPick, onClose }: { names: () => readonly string[]; current?: string; onPick: (name: string) => void; onClose: () => void }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const shown = names().filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: c.bg }]}>
        <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>Choose an ingredient</Heading>
        <Field label="Search ingredients" placeholder="Search" value={q} onChangeText={setQ} />
        <FlatList
          data={shown}
          keyExtractor={(n) => n}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={{ color: c.muted }}>No ingredient matches.</Text>}
          renderItem={({ item }) => (
            <Press accessibilityRole="button" accessibilityLabel={item} {...a11yState({ pressed: item === current })} onPress={() => onPick(item)} style={[styles.item, { backgroundColor: item === current ? c.tint : 'transparent' }]}>
              <Text style={{ color: c.ink }}>{item}</Text>
            </Press>
          )}
        />
        <Button label="Cancel" kind="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 6 },
  start: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pick: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 8, justifyContent: 'center' },
  unit: { minWidth: 56, minHeight: 44, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, padding: 16, gap: 8 },
  item: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: radius.md },
});
