import { useState } from 'react';
import { SheetModal } from '../components/Sheet';
import { WhyLink } from '../why/WhyLink';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { customFood, highProtein, num, quantityFromGrams, searchFoods, servingUnitTooLong, SERVINGS_MAX, SERVINGS_MIN, stepServings, type CustomFoodResult, type UserFoodFacts } from '@plate-and-bar/core';
import { fmt } from '../format';
import { a11yState, Heading, Button, ErrorText, Field, Hint, Label, Switch, Press } from '../components/ui';
import { radius, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AI_COPY } from '../ai/copy';
import { getFoodCatalog, getCuisines, type CatalogFood } from './catalog';
import { CUSTOM_MESSAGE, EATOUT_HINT, GRAMS_HINT, noMatch, notInGrams, SOURCE_HINT, TOO_SMALL, UNIT_TOO_LONG } from './copy';
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
  /** Opens the Describe flow for this meal. Given only when the describe-meal feature is available (consent, server, signed in). */
  onDescribe?: () => void;
}

/** The add-food sheet: food list (search, servings or grams), eating out, custom food, and Describe it (AI) when it is on. */
export function AddSheet({ meal, mine, mineFacts, onAdd, onSaveMine, onClose, onDescribe }: Props) {
  const c = useTheme();
  const [mode, setMode] = useState<Mode>('list');
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const say = (text: string, error = false) => setStatus({ text, error });
  return (
    <SheetModal title={`Add to ${meal.toLowerCase()}`} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{`Add to ${meal.toLowerCase()}`}</Heading>
          <View accessibilityRole="tablist" style={styles.row}>
            {MODES.map(([k, l]) => (
              <Press key={k} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="tab" accessibilityLabel={l} {...a11yState({ selected: mode === k })} onPress={() => { setMode(k); setStatus(null); }}
                style={[styles.tab, { backgroundColor: mode === k ? c.brand : c.surfaceSoft }]}>
                <Text style={{ color: mode === k ? c.onBrand : c.ink, ...type.buttonSm }}>{l}</Text>
              </Press>
            ))}
            {onDescribe ? (
              <Press hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button" accessibilityLabel={`${AI_COPY.describeButton}, AI estimate`} onPress={onDescribe} style={[styles.tab, { backgroundColor: c.surfaceSoft }]}>
                <Text style={{ color: c.ink, ...type.buttonSm }}>{AI_COPY.describeButton}</Text>
              </Press>
            ) : null}
          </View>
          {mode === 'list' ? <ListTab mine={mine} mineFacts={mineFacts} onAdd={onAdd} say={say} canDescribe={!!onDescribe} /> : null}
          {mode === 'out' ? <EatOutTab onAdd={onAdd} say={say} /> : null}
          {mode === 'custom' ? <CustomTab meal={meal} onAdd={onAdd} onSaveMine={onSaveMine} onClose={onClose} say={say} /> : null}
          {status ? (status.error ? <ErrorText>{status.text}</ErrorText> : <Text accessibilityRole="alert" style={{ color: c.link, fontWeight: '600' }}>{status.text}</Text>) : null}
          <Button label="Done" onPress={onClose} kind="ghost" />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

type Say = (text: string, error?: boolean) => void;

function Row({ food, onPress, sub, badge = true }: { food: CatalogFood; onPress: () => void; sub: string; badge?: boolean }) {
  const high = badge && highProtein(food);
  const c = useTheme();
  const kcal = `${fmt(food.per_serving.kcal)} kcal`;
  // WCAG 2.5.3: the accessible name is the visible text in reading order (name, kcal, then the detail line) plus a hint, so it
  // starts with what a sighted user reads. The spaces after the name and the kcal keep a checker from joining them into one word.
  // The kcal sits in the first line so the name stays a prefix even when a scroll edge clips the detail line.
  return (
    <Press accessibilityRole="button" accessibilityLabel={`${food.name} ${kcal} ${sub}${high ? ' · high protein' : ''}, tap to add`} onPress={onPress} style={[styles.food, { backgroundColor: c.surface }]}>
      <View style={styles.fill}>
        <View style={styles.foodHead}>
          <Text style={{ color: c.ink, fontWeight: '600', fontSize: 16, flex: 1 }}>{food.name} </Text>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{kcal} </Text>
        </View>
        <Text style={{ color: c.muted, fontSize: 14 }}>{sub}{high ? ' · high protein' : ''}</Text>
      </View>
    </Press>
  );
}

function ListTab({ mine, mineFacts, onAdd, say, canDescribe }: { canDescribe: boolean; mine: readonly UserFood[]; mineFacts: readonly UserFoodFacts[]; onAdd: (n: NewLog) => void; say: Say }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const [serv, setServ] = useState(1);
  const [grams, setGrams] = useState('');
  // My foods first, then the bundled list, as prototype `allFoods()`.
  const own: CatalogFood[] = mineFacts.map((f, i) => ({ ...f, id: mine[i]?.id ?? null }));
  const list = searchFoods(q, [...own, ...getFoodCatalog()]);
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
        <Press accessibilityRole="button" accessibilityLabel="Fewer servings" onPress={() => setServ(stepServings(serv, -1))} disabled={serv <= SERVINGS_MIN} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>−</Text></Press>
        <Text accessibilityLabel={`${serv.toFixed(1)} servings`} style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>{serv.toFixed(1)}</Text>
        <Press accessibilityRole="button" accessibilityLabel="More servings" onPress={() => setServ(stepServings(serv, 1))} disabled={serv >= SERVINGS_MAX} style={[styles.step, { borderColor: c.line }]}><Text style={{ color: c.ink, fontSize: 20 }}>+</Text></Press>
        <Field label="Amount in grams" placeholder="or grams" keyboardType="numeric" value={grams} onChangeText={setGrams} />
      </View>
      <Hint>{GRAMS_HINT}</Hint>
      <Field label="Search foods" placeholder="Search roti, paneer, whey…" value={q} onChangeText={setQ} style={styles.search} />
      {list.length ? <Hint>{SOURCE_HINT}</Hint> : null}
      {list.length ? list.map((f) => <Row key={`${f.id}:${f.name}`} food={f} sub={`${f.serving.label}, ${f.per_serving.protein_g} g protein`} onPress={() => pick(f)} />) : <Hint>{noMatch(canDescribe)}</Hint>}
    </View>
  );
}

function EatOutTab({ onAdd, say }: { onAdd: (n: NewLog) => void; say: Say }) {
  const c = useTheme();
  const [name, setName] = useState(getCuisines()[0]?.name ?? '');
  const cu = getCuisines().find((x) => x.name === name);
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        {getCuisines().map((x) => (
          <Press key={x.name} hitSlop={{ top: 6, bottom: 6 }} accessibilityRole="button" accessibilityLabel={x.name} {...a11yState({ pressed: x.name === name })} onPress={() => setName(x.name)}
            style={[styles.tab, { borderColor: x.name === name ? c.brand : c.line, backgroundColor: x.name === name ? c.tint : c.surface }]}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{x.name}</Text>
          </Press>
        ))}
      </View>
      <Label>Smart picks</Label>
      {name === 'Drinks' ? <WhyLink id="alcohol" /> : null}
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
    // Only the saved food carries the unit, so a long unit blocks only when it would be saved.
    if (save && servingUnitTooLong(f.unit)) return say(UNIT_TOO_LONG, true);
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
  foodHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  search: { maxWidth: undefined },
  wide: { maxWidth: undefined },
});
