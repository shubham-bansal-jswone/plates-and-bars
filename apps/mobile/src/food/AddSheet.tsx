import { useState, type ReactNode } from 'react';
import { SheetModal } from '../components/Sheet';
import { WhyLink } from '../why/WhyLink';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { customFood, highProtein, num, quantityFromGrams, searchFoods, servingUnitTooLong, SERVINGS_MAX, SERVINGS_MIN, stepServings, type UserFoodFacts, type UserFoodFields } from '@plate-and-bar/core';
import { fmt } from '../format';
import { a11yState, Heading, Button, ErrorText, Field, Caption, Hint, Label, Switch, Press } from '../components/ui';
import { radius, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AI_COPY } from '../ai/copy';
import { BARCODE_COPY } from '../barcode/copy';
import { barcodeScanEnabled } from '../barcode/flag';
import { OffCredit } from '../barcode/OffCredit';
import { LABEL_COPY } from '../labelscan/copy';
import { labelScanEnabled } from '../labelscan/flag';
import { LabelScanFlow } from '../labelscan/LabelScanFlow';
import { ScanFlow } from '../barcode/ScanFlow';
import { DescribeBody } from '../ai/DescribeSheet';
import { PhotoBody } from '../ai/PhotoBody';
import { getFoodCatalog, getCuisines, type CatalogFood } from './catalog';
import { CUSTOM_MESSAGE, EATOUT_HINT, GRAMS_HINT, noMatch, notInGrams, SOURCE_HINT, TOO_SMALL, UNIT_TOO_LONG } from './copy';
import { logOf, type NewLog } from './useFoodDay';

import type { UserFood } from './types';

export type Mode = 'list' | 'out' | 'custom' | 'describe' | 'photo';
const MODES: [Mode, string][] = [['list', 'Food list'], ['out', 'Eating out'], ['custom', 'Custom']];
const DESCRIBE_MODE: [Mode, string] = ['describe', AI_COPY.describeButton];
const PHOTO_MODE: [Mode, string] = ['photo', AI_COPY.photoTab];

interface Props {
  meal: string;
  mine: readonly UserFood[];
  mineFacts: readonly UserFoodFacts[];
  onAdd: (n: NewLog) => void;
  /** `barcode` is set on a food made from a scan (or a typed barcode); the saved food keeps it so a repeat scan finds it with no lookup. */
  onSaveMine: (f: UserFoodFields & { barcode?: string | null }) => UserFood;
  onClose: () => void;
  /** True when the describe-meal feature is available (consent, server, signed in): shows the Describe it tab. */
  canDescribe?: boolean;
  /** True when the meal-photo feature is available: shows the Photo tab. */
  canPhoto?: boolean;
  /** The tab to open on (the Food tab's Snap a meal opens Photo). */
  initialMode?: Mode;
  /** Shows a short message after the sheet closes (the Food tab's toast). */
  onToast?: (msg: string) => void;
}

/** The add-food sheet: food list (search, servings or grams), eating out, custom food, and Describe it (AI) when it is on. */
export function AddSheet({ meal, mine, mineFacts, onAdd, onSaveMine, onClose, canDescribe = false, canPhoto = false, initialMode = 'list', onToast }: Props) {
  const c = useTheme();
  const [mode, setMode] = useState<Mode>(initialMode);
  // Describe keeps its text, estimate and pending request while another tab is shown, as the prototype's FS does: it mounts on
  // the first visit and is then only hidden. It stays reachable while selected even if AI is switched off, so its message shows.
  const [seenDescribe, setSeenDescribe] = useState(initialMode === 'describe');
  const [seenPhoto, setSeenPhoto] = useState(initialMode === 'photo');
  const own: CatalogFood[] = mineFacts.map((f, i) => ({ ...f, id: mine[i]?.id ?? null }));
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const say = (text: string, error = false) => setStatus({ text, error });
  // Scan barcode (#944, behind EXPO_PUBLIC_BARCODE_SCAN): the scanner flow is a full-screen modal over this sheet. "Enter by hand"
  // closes it and opens Custom with the code, which is saved with the food.
  const [scanning, setScanning] = useState(false);
  const [customCode, setCustomCode] = useState<string | null>(null);
  // Scan a nutrition label (#1067, behind EXPO_PUBLIC_LABEL_SCAN): a full-screen flow over this sheet; "Type it in" closes it and opens Custom.
  const [scanningLabel, setScanningLabel] = useState(false);
  return (
    <SheetModal title={`Add to ${meal.toLowerCase()}`} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>{`Add to ${meal.toLowerCase()}`}</Heading>
          <View accessibilityRole="tablist" style={styles.row}>
            {[...MODES, ...(canDescribe || mode === 'describe' ? [DESCRIBE_MODE] : []), ...(canPhoto || mode === 'photo' ? [PHOTO_MODE] : [])].map(([k, l]) => (
              <Press key={k} accessibilityRole="tab" accessibilityLabel={l} {...a11yState({ selected: mode === k })} onPress={() => { setMode(k); setStatus(null); if (k !== 'custom') setCustomCode(null); if (k === 'describe') setSeenDescribe(true); if (k === 'photo') setSeenPhoto(true); }}
                style={styles.tabHit}>
                <View style={[styles.tab, { backgroundColor: mode === k ? c.brand : c.surfaceSoft }]}>
                  <Text style={{ color: mode === k ? c.onBrand : c.ink, ...type.buttonSm }}>{l}</Text>
                </View>
              </Press>
            ))}
          </View>
          {mode === 'list' ? <ListTab mine={mine} mineFacts={mineFacts} onAdd={onAdd} say={say} canDescribe={canDescribe} onScan={barcodeScanEnabled() ? () => setScanning(true) : undefined} onScanLabel={labelScanEnabled() ? () => setScanningLabel(true) : undefined} /> : null}
          {mode === 'out' ? <EatOutTab onAdd={onAdd} say={say} /> : null}
          {mode === 'custom' ? <CustomTab meal={meal} onAdd={onAdd} onSaveMine={onSaveMine} onClose={onClose} say={say} barcode={customCode} /> : null}
          {seenDescribe ? (
            <View style={mode === 'describe' ? undefined : styles.hidden} accessibilityElementsHidden={mode !== 'describe'} importantForAccessibility={mode === 'describe' ? 'auto' : 'no-hide-descendants'}>
              <DescribeBody meal={meal} onAdd={onAdd} onClose={onClose} />
            </View>
          ) : null}
          {seenPhoto ? (
            <View style={mode === 'photo' ? undefined : styles.hidden} accessibilityElementsHidden={mode !== 'photo'} importantForAccessibility={mode === 'photo' ? 'auto' : 'no-hide-descendants'}>
              <PhotoBody meal={meal} foods={[...own, ...getFoodCatalog()]} onAdd={onAdd} onSaveMine={onSaveMine} onAdded={(n) => onToast?.(AI_COPY.photoAdded(n))} onClose={onClose} />
            </View>
          ) : null}
          {status ? (status.error ? <ErrorText>{status.text}</ErrorText> : <Text accessibilityRole="alert" style={{ color: c.link, fontWeight: '600' }}>{status.text}</Text>) : null}
          <Button label="Done" onPress={onClose} kind="ghost" />
        </View>
      </ScrollView>
      {scanning ? (
        <ScanFlow meal={meal} mine={mine} onAdd={onAdd} onSaveMine={onSaveMine} onClose={() => setScanning(false)} onDone={() => { setScanning(false); onClose(); }}
          onCustom={(code) => { setScanning(false); setCustomCode(code); setMode('custom'); setStatus(null); }} />
      ) : null}
      {scanningLabel ? (
        <LabelScanFlow meal={meal} onAdd={onAdd} onSaveMine={onSaveMine} onClose={() => setScanningLabel(false)} onDone={() => { setScanningLabel(false); onClose(); }}
          onCustom={() => { setScanningLabel(false); setCustomCode(null); setMode('custom'); setStatus(null); }} />
      ) : null}
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

function ListTab({ mine, mineFacts, onAdd, say, canDescribe, onScan, onScanLabel }: { canDescribe: boolean; onScan?: () => void; onScanLabel?: () => void; mine: readonly UserFood[]; mineFacts: readonly UserFoodFacts[]; onAdd: (n: NewLog) => void; say: Say }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const [serv, setServ] = useState(1);
  const [grams, setGrams] = useState('');
  // My foods first, then the bundled list, as prototype `allFoods()`.
  const own: CatalogFood[] = mineFacts.map((f, i) => ({ ...f, id: mine[i]?.id ?? null }));
  // A scanned food carries the Open Food Facts credit on its row (ODbL, spec D7): looked up by id, since the list mixes in the bundled foods.
  const codeOf = (f: CatalogFood): string | null => (f.id ? mine.find((m) => m.id === f.id)?.barcode ?? null : null);
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
      <View style={styles.row}>
        <Field label="Search foods" placeholder="Search roti, paneer, whey…" value={q} onChangeText={setQ} style={styles.fill} />
        {onScan ? <Button kind="ghost" label={BARCODE_COPY.scanButton} a11yLabel={BARCODE_COPY.scanButtonA11y} onPress={onScan} /> : null}
        {onScanLabel ? <Button kind="ghost" label={LABEL_COPY.entry} a11yLabel={LABEL_COPY.entryA11y} onPress={onScanLabel} /> : null}
      </View>
      {list.length ? <Hint>{SOURCE_HINT}</Hint> : null}
      {list.length ? list.map((f) => (
        <View key={`${f.id}:${f.name}`}>
          <Row food={f} sub={`${f.serving.label}, ${f.per_serving.protein_g} g protein`} onPress={() => pick(f)} />
          {codeOf(f) ? <OffCredit code={codeOf(f) as string} /> : null}
        </View>
      )) : <Hint>{noMatch(canDescribe)}</Hint>}
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

/** A visible caption over one field of the custom-food grid; the caption text is the field's accessible name. */
function Captioned({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <View style={[styles.captioned, wide ? styles.captionedWide : null]}><Caption>{label}</Caption>{children}</View>;
}

function CustomTab({ meal, onAdd, onSaveMine, onClose, say, barcode }: { barcode: string | null; meal: string; onAdd: (n: NewLog) => void; onSaveMine: Props['onSaveMine']; onClose: () => void; say: Say }) {
  const [f, setF] = useState({ name: '', kcal: '', protein: '', carbs: '', fat: '', qty: '1', unit: '' });
  const [save, setSave] = useState(true);
  const set = (k: keyof typeof f) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const submit = () => {
    const r = customFood(f);
    if (r.kind !== 'ok') return say(CUSTOM_MESSAGE[r.kind], true);
    // Only the saved food carries the unit, so a long unit blocks only when it would be saved.
    if (save && servingUnitTooLong(f.unit)) return say(UNIT_TOO_LONG, true);
    // A saved food is logged with its id so the log points at it; an unsaved one has no food.
    onAdd({ ...r.log, foodId: save ? onSaveMine(barcode ? { ...r.food, barcode } : r.food).id : null });
    onClose();
  };
  return (
    <View style={styles.gap}>
      {barcode ? <Hint>{`${BARCODE_COPY.customCode} ${barcode}`}</Hint> : null}
      <Caption>Food</Caption>
      <Field label="Food" placeholder="e.g. Office canteen thali" value={f.name} onChangeText={set('name')} />
      <View style={styles.row}>
        <Captioned label="Calories (kcal)" wide><Field label="Calories (kcal)" placeholder="auto from macros" keyboardType="decimal-pad" value={f.kcal} onChangeText={set('kcal')} style={styles.fieldWide} /></Captioned>
        <Captioned label="Servings"><Field label="Servings" keyboardType="decimal-pad" value={f.qty} onChangeText={set('qty')} style={styles.fieldFill} /></Captioned>
        <Captioned label="Protein (g)"><Field label="Protein (g)" keyboardType="decimal-pad" value={f.protein} onChangeText={set('protein')} style={styles.fieldFill} /></Captioned>
        <Captioned label="Carbs (g)"><Field label="Carbs (g)" keyboardType="decimal-pad" value={f.carbs} onChangeText={set('carbs')} style={styles.fieldFill} /></Captioned>
        <Captioned label="Fat (g)"><Field label="Fat (g)" keyboardType="decimal-pad" value={f.fat} onChangeText={set('fat')} style={styles.fieldFill} /></Captioned>
        <Captioned label="Serving size"><Field label="Serving size" placeholder="1 plate" value={f.unit} onChangeText={set('unit')} style={styles.fieldFill} /></Captioned>
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
  hidden: { display: 'none' },
  // The 32px pill is the design; the Press around it is the 44px target.
  tabHit: { minHeight: 44, minWidth: 44, borderRadius: radius.full, justifyContent: 'center' },
  tab: { borderRadius: radius.full, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' },
  step: { borderWidth: 1, borderRadius: radius.full, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  food: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: 16, minHeight: 56 },
  fill: { flex: 1 },
  foodHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  captioned: { gap: 4, minWidth: 90, flexGrow: 1, maxWidth: 160 },
  captionedWide: { maxWidth: '100%', flexBasis: '100%' },
  fieldFill: { flexGrow: 0 },
  fieldWide: { flexGrow: 0, maxWidth: '100%' },
});
