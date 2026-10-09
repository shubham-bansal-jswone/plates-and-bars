import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { customFood } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, ErrorText, Field, Hint, Label } from '../components/ui';
import { CUSTOM_MESSAGE } from '../food/copy';
import type { NewLog } from '../food/useFoodDay';
import { useTheme } from '../theme/useTheme';
import { useAi } from './AiProvider';
import { AI_COPY, failureMessage } from './copy';

interface Row {
  key: number;
  name: string;
  qty: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

const TEXT_MAX = 1000;

/**
 * Describe a meal in words (AI). The suggested items are only suggestions: each is shown to edit or drop, and nothing is
 * logged until the user taps Add. The text and the suggestions live in this sheet's state only.
 */
export function DescribeSheet({ meal, onAdd, onClose }: { meal: string; onAdd: (n: NewLog) => void; onClose: () => void }) {
  const c = useTheme();
  const ai = useAi();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const exhausted = ai.quotaUsed();
  const estimate = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    const r = await ai.describeMeal(text);
    if (!alive.current) return;
    setBusy(false);
    if (r.kind !== 'ok') return setError(failureMessage(r, AI_COPY.describeFallback));
    if (!r.data.items.length) return setError(AI_COPY.describeNone);
    setRows(r.data.items.map((i, key) => ({ key, name: i.name, qty: i.qty, kcal: String(i.kcal), protein: String(i.protein_g), carbs: String(i.carbs_g), fat: String(i.fat_g) })));
  };

  const set = (key: number, k: keyof Row) => (v: string) => setRows((rs) => rs && rs.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const addAll = () => {
    if (!rows) return;
    const logs: NewLog[] = [];
    for (const r of rows) {
      const q = r.qty.trim();
      const res = customFood({ name: q ? `${r.name.trim()} (${q})` : r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, qty: '1', unit: q });
      if (res.kind !== 'ok') return setError(`${r.name || 'An item'}: ${CUSTOM_MESSAGE[res.kind]}`);
      logs.push({ ...res.log, foodId: null });
    }
    logs.forEach(onAdd);
    onClose();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{AI_COPY.describeTitle(meal)}</Text>
          {rows ? (
            <>
              <Hint>{AI_COPY.reviewHint}</Hint>
              {rows.map((r) => (
                <Card key={r.key} style={styles.gap}>
                  <Field label={`Item ${r.key + 1} name`} value={r.name} onChangeText={set(r.key, 'name')} />
                  <Field label={`${r.name || 'Item'} amount`} value={r.qty} onChangeText={set(r.key, 'qty')} />
                  <View style={styles.row}>
                    <Field label={`${r.name || 'Item'} calories (kcal)`} keyboardType="decimal-pad" value={r.kcal} onChangeText={set(r.key, 'kcal')} />
                    <Field label={`${r.name || 'Item'} protein (g)`} keyboardType="decimal-pad" value={r.protein} onChangeText={set(r.key, 'protein')} />
                    <Field label={`${r.name || 'Item'} carbs (g)`} keyboardType="decimal-pad" value={r.carbs} onChangeText={set(r.key, 'carbs')} />
                    <Field label={`${r.name || 'Item'} fat (g)`} keyboardType="decimal-pad" value={r.fat} onChangeText={set(r.key, 'fat')} />
                  </View>
                  <Button kind="link" label="Remove" a11yLabel={`Remove ${r.name || 'item'}`} onPress={() => setRows((rs) => (rs ? rs.filter((x) => x.key !== r.key) : rs))} />
                </Card>
              ))}
              {error ? <ErrorText>{error}</ErrorText> : null}
              {rows.length ? <Button label={`Add ${rows.length} item${rows.length > 1 ? 's' : ''} to ${meal.toLowerCase()}`} onPress={addAll} /> : <Hint>Nothing left to add.</Hint>}
              <Button kind="ghost" label="Describe again" onPress={() => { setRows(null); setError(null); }} />
              <Hint>{AI_COPY.aiNote}</Hint>
            </>
          ) : (
            <>
              <Hint>{AI_COPY.describeHint}</Hint>
              <Label>What did you eat?</Label>
              <Field label="Describe your meal" placeholder="2 rotis and a katori of dal" multiline maxLength={TEXT_MAX} value={text} onChangeText={setText} />
              {exhausted ? <ErrorText>{failureMessage({ kind: 'quota', quota: ai.quota }, AI_COPY.describeFallback)}</ErrorText> : error ? <ErrorText>{error}</ErrorText> : null}
              <Button label={busy ? 'Estimating…' : 'Estimate'} onPress={() => void estimate()} />
            </>
          )}
          <Button kind="ghost" label="Close" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 10 },
  gap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
