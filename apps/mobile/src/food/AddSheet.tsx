import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { customFood, highProtein, num, quantityFromGrams, searchFoods, SERVINGS_MAX, SERVINGS_MIN, stepServings, type CustomFoodResult, type UserFoodFacts } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Button, ErrorText, Field, Hint, Label, Switch } from '../components/ui';
import { radius, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { catalogFoods, cuisines, type CatalogFood } from './catalog';
import { CUSTOM_MESSAGE, EATOUT_HINT, GRAMS_HINT, notInGrams, SOURCE_HINT, TOO_SMALL } from './copy';
import { logOf, type NewLog } from './useFoodDay';

import type { UserFood } from './types';

type Mode = 'list' | 'out' | 'custom';
const MODES: [Mode, string][] = [['list', 'Food list'], ['out', 'Eating out'], ['custom', 'Custom']];

interface Props {
  meal: string;
  mine: readonly UserFood[];
  mineFacts: readonly UserFoodFacts[];
  onAdd: (n: NewLog) => void;
  onSaveMine: (f: Extract<CustomFoodResult, { kind: 'ok' }>['food']) => UserFood;
  onClose: () => void;
}

/** The add-food sheet: food list (search, servings or grams), eating out, custom food. */
export function AddSheet({ meal, mine, mineFacts, onAdd, onSaveMine, onClose }: Props) {
  const c = useTheme();
  const [mode, setMode] = useState<Mode>('list');
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const say = (text: string, error = false) => setStatus({ text, error });
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{`Add to ${meal.toLowerCase()}`}</Text>
          <View accessibilityRole="tablist" style={styles.row}>
            {MODES.map(([k, l]) => (
              <Pressable key={k} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="tab" accessibilityLabel={l} accessibilityState={{ selected: mode === k }} onPress={() => { setMode(k); setStatus(null); }}
                style={[styles.tab, { backgroundColor: mode === k ? c.brand : c.surfaceSoft }]}>
                <Text style={{ color: mode === k ? c.onBrand : c.ink, ...type.buttonSm }}>{l}</Text>
              </Pressable>
            ))}
          </View>
          {mode === 'list' ? <ListTab mine={mine} mineFacts={mineFacts} onAdd={onAdd} say={say} /> : null}
          {mode === 'out' ? <EatOutTab onAdd={onAdd} say={say} /> : null}
          {mode === 'custom' ? <CustomTab meal={meal} onAdd={onAdd} onSaveMine={onSaveMine} onClose={onClose} say={say} /> : null}
          {status ? (status.error ? <ErrorText>{status.text}</ErrorText> : <Text accessibilityRole="alert" style={{ color: c.link, fontWeight: '600' }}>{status.text}</Text>) : null}
          <Button label="Done" onPress={onClose} kind="ghost" />
        </View>
      </ScrollView>
    </Modal>
  );
}

type Say = (text: string, error?: boolean) => void;

function Row({ food, onPress, sub, badge = true }: { food: CatalogFood; onPress: () => void; sub: string; badge?: boolean }) {
  const high = badge && highProtein(food);
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Add ${food.name}, ${sub}, ${fmt(food.per_serving.kcal)} kcal${high ? ', high protein' : ''}`} onPress={onPress} style={[styles.food, { backgroundColor: c.surface }]}>
      <View style={styles.fill}>
        <Text style={{ color: c.ink, fontWeight: '600', fontSize: 16 }}>{food.name}</Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>{sub}{high ? ' · high protein' : ''}</Text>
      </View>
      <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(food.per_serving.kcal)}</Text>
    </Pressable>
  );
}

function ListTab({ mine, mineFacts, onAdd, say }: { mine: readonly UserFood[]; mineFacts: readonly UserFoodFacts[]; onAdd: (n: NewLog) => void; say: Say }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const [serv, setServ] = useState(1);
  const [grams, setGrams] = useState('');
  // My foods first, then the bundled list, as prototype `allFoods()`.
  const own: CatalogFood[] = mineFacts.map((f, i) => ({ ...f, id: mine[i]?.id ?? null }));
  const list = searchFoods(q, [...own, ...catalogFoods]);
  const pick = (f: CatalogFood) => {
    const r = quantityFromGrams(f, grams);
    if (r.kind === 'not-in-grams') return say(notInGrams(f.name, f.serving.label), true);
    if (r.kind === 'too-small') return say(TOO_SMALL, true);
    const qty = r.kind === 'grams' ? r.qty : serv;
    onAdd(logOf(f, qty));
    say(`Added ${f.name}${r.kind === 'grams' ? ` (${fmt(num(grams))} g)` : qty !== 1 ? ` ×${qty}` : ''}`);
  };
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <Label>Servings</Label>
        <Pressable accessibilityRole="button" accessibilityLabel="Fewer servings" onPress={() => setServ(stepServings(serv, -1))} disabled={serv <= SERVINGS_MIN} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>−</Text></Pressable>
        <Text accessibilityLabel={`${serv.toFixed(1)} servings`} style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>{serv.toFixed(1)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="More servings" onPress={() => setServ(stepServings(serv, 1))} disabled={serv >= SERVINGS_MAX} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>+</Text></Pressable>
        <Field label="Amount in grams" placeholder="or grams" keyboardType="numeric" value={grams} onChangeText={setGrams} />
      </View>
      <Hint>{GRAMS_HINT}</Hint>
      <Field label="Search foods" placeholder="Search roti, paneer, whey…" value={q} onChangeText={setQ} style={styles.search} />
      {list.length ? <Hint>{SOURCE_HINT}</Hint> : null}
      {list.length ? list.map((f) => <Row key={`${f.id}:${f.name}`} food={f} sub={`${f.serving.label}, ${f.per_serving.protein_g} g protein`} onPress={() => pick(f)} />) : <Hint>No match. Use Custom to enter it yourself.</Hint>}
    </View>
  );
}

function EatOutTab({ onAdd, say }: { onAdd: (n: NewLog) => void; say: Say }) {
  const c = useTheme();
  const [name, setName] = useState(cuisines[0]?.name ?? '');
  const cu = cuisines.find((x) => x.name === name);
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        {cuisines.map((x) => (
          <Pressable key={x.name} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button" accessibilityLabel={x.name} accessibilityState={{ selected: x.name === name }} onPress={() => setName(x.name)}
            style={[styles.tab, { borderColor: x.name === name ? c.brand : c.line, backgroundColor: x.name === name ? c.tint : c.surface }]}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{x.name}</Text>
          </Pressable>
        ))}
      </View>
      <Label>Smart picks</Label>
      {cu?.tips.map((t) => <Hint key={t}>{`• ${t}`}</Hint>)}
      {cu?.dishes.map((d) => <Row key={d.id ?? d.name} food={d} badge={false} sub={`${d.per_serving.protein_g} g protein, ${d.per_serving.carbs_g} g carbs, ${d.per_serving.fat_g} g fat`} onPress={() => { onAdd(logOf(d, 1)); say(`Added ${d.name}`); }} />)}
      <Hint>{EATOUT_HINT}</Hint>
    </View>
  );
}

function CustomTab({ meal, onAdd, onSaveMine, onClose, say }: { meal: string; onAdd: (n: NewLog) => void; onSaveMine: Props['onSaveMine']; onClose: () => void; say: Say }) {
  const [f, setF] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', qty: '1', unit: '' });
  const [save, setSave] = useState(true);
  const set = (k: keyof typeof f) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const submit = () => {
    const r = customFood(f);
    if (r.kind !== 'ok') return say(CUSTOM_MESSAGE[r.kind], true);
    // A saved food is logged with its id so the log points at it; an unsaved one has no food.
    onAdd({ ...r.log, foodId: save ? onSaveMine(r.food).id : null });
    onClose();
  };
  return (
    <View style={styles.gap}>
      <Field label="Food" placeholder="e.g. Office canteen thali" value={f.name} onChangeText={set('name')} style={styles.wide} />
      <View style={styles.row}>
        <Field label="Calories (kcal)" placeholder="auto from macros" keyboardType="decimal-pad" value={f.kcal} onChangeText={set('kcal')} />
        <Field label="Servings" keyboardType="decimal-pad" value={f.qty} onChangeText={set('qty')} />
        <Field label="Protein (g)" placeholder="Protein (g)" keyboardType="decimal-pad" value={f.protein} onChangeText={set('protein')} />
        <Field label="Carbs (g)" placeholder="Carbs (g)" keyboardType="decimal-pad" value={f.carbs} onChangeText={set('carbs')} />
        <Field label="Fat (g)" placeholder="Fat (g)" keyboardType="decimal-pad" value={f.fat} onChangeText={set('fat')} />
        <Field label="Serving size" placeholder="1 plate" value={f.unit} onChangeText={set('unit')} />
      </View>
      <View style={styles.row}>
        <Switch accessibilityLabel="Save to my foods for next time" value={save} onValueChange={setSave} />
        <Label>Save to my foods for next time</Label>
      </View>
      <Button label={`Add to ${meal.toLowerCase()}`} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  gap: { gap: 8 },
  tab: { borderRadius: radius.full, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
  step: { borderWidth: 1, borderRadius: radius.full, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  food: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: 16, minHeight: 56 },
  fill: { flex: 1 },
  search: { maxWidth: undefined },
  wide: { maxWidth: undefined },
});
