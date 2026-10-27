import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { kitchenCompare, kitchenNoteTooLong, kitchenTable, kitchenTest, kitchenTestFood, type KitchenCompareFood, type KitchenTestFoodInput } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Caption, ErrorText, Field, H1, Hint, Label, Page, Press, Chip } from '../components/ui';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { CameraDenied, capturePhoto } from '../photos/capture';
import { persistent } from '../photos/vault';
import { fmt, shortDate } from '../format';
import { BAD_DATE, compareLine, COPY_TABLE, LOAD_FAILED, PHOTO_ADD, PHOTO_ADDED, PHOTO_CAMERA_OFF, PHOTO_HINT, PHOTO_HINT_WEB, PHOTO_PICK_FAILED, HOW_TO, HOW_TO_HINT, listIntro, NO_SERVING_HINT, NOT_READY_HINT, NOTE_TOO_LONG, problem, TABLE_COPIED, TABLE_COPY_FAILED } from '../kitchen/copy';
import { SERVING_NAMES } from '../kitchen/types';
import { useKitchenTests, type TestFields } from '../kitchen/useKitchenTests';
import { getFoodCatalog } from '../food/catalog';
import { getRawIngredients, getShippedRawNames } from '../recipes/content';
import { IngredientRows } from '../recipes/IngredientRows';
import { localDate } from '../setup/logic';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const blank = (date: string): TestFields => ({ id: newId(), name: '', date, note: '', rows: [{ ingredient: 'Toor dal (dry)', amount: '', unit: 'g' }], pot: '', potFull: '', cooked: '', serving: '', sname: 'katori' });
const validDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && localDate(new Date(`${s}T00:00:00`)) === s;

interface Props {
  db: WorkoutDb;
  onBack: () => void;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/** Kitchen tests (prototype `ktSheet` and `ktListHtml`): weigh a dish, get per 100 g and per serving, and use it for logging. Numbers are core's. */
export function KitchenTestScreen({ db, onBack, now = () => new Date() }: Props) {
  const c = useTheme();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const store = useKitchenTests({ db, now, notify });
  const [d, setD] = useState<TestFields | null>(null);
  const [showHow, setShowHow] = useState<boolean | null>(null);
  const leaving = useRef(false);
  // Back waits for queued writes; a second press while waiting does nothing.
  const back = () => {
    if (leaving.current) return;
    leaving.current = true;
    void store.idle().then(onBack, onBack);
  };
  // Prototype `ktExport`: oldest first, as saved.
  const copyTable = () => {
    const text = kitchenTable([...store.tests].reverse(), getRawIngredients());
    Clipboard.setStringAsync(text).then((ok) => notify(ok ? TABLE_COPIED : TABLE_COPY_FAILED), () => notify(TABLE_COPY_FAILED));
  };
  if (store.failed) return <Page><ErrorText>{LOAD_FAILED}</ErrorText><Button label="Back" kind="link" onPress={back} /></Page>;
  if (!store.ready) return <Page><Hint>Loading…</Hint></Page>;

  if (!d) {
    return (
      <View style={styles.fill}>
        <Page>
          <H1>Kitchen tests</H1>
          <Hint>{listIntro(store.tests.length)}</Hint>
          {store.tests.map((t) => {
            const ps = (() => {
              const r = kitchenTest(t, getRawIngredients());
              return r.ready ? r.perServing : null;
            })();
            return (
              <View key={t.id} style={styles.between}>
                <View style={styles.fill}>
                  <Text style={{ color: c.ink, fontWeight: '600' }}>{t.name}</Text>
                  <Text style={{ color: c.muted, fontSize: 14 }}>{`${shortDate(t.date)}${ps ? `, ${fmt(ps.kcal)} kcal per ${t.serving_name} (${fmt(ps.grams)} g)` : ''}${t.note ? `, ${t.note}` : ''}`}</Text>
                </View>
                <Press accessibilityRole="button" accessibilityLabel={`Delete ${t.name}`} onPress={() => { store.remove(t.id); notify('Test deleted'); }} style={styles.x}><Text style={{ color: c.muted, fontSize: 22 }}>×</Text></Press>
              </View>
            );
          })}
          <View style={styles.wrap}>
            <Button label="New kitchen test" onPress={() => setD(blank(localDate(now())))} />
            {store.tests.length ? <Button label={COPY_TABLE} kind="ghost" onPress={copyTable} /> : null}
            <Button label="Back" kind="link" onPress={back} />
          </View>
        </Page>
        <ToastBar message={toast} />
      </View>
    );
  }

  const input: KitchenTestFoodInput = { name: d.name, serving_name: d.sname, ingredients: d.rows, pot_g: d.pot, pot_full_g: d.potFull, cooked_g: d.cooked, serving_g: d.serving };
  const res = kitchenTest(input, getRawIngredients());
  // Prototype `allFoods()`: my foods first, then the built-in ones. The name is trimmed here (the prototype compares it as typed,
  // so a keyboard's trailing space hid the comparison).
  const foods: KitchenCompareFood[] = [...store.mine, ...getFoodCatalog().map((f) => ({ name: f.name, unit: f.serving.label, kcal: f.per_serving.kcal }))];
  const cmp = res.ready ? kitchenCompare(d.name.trim(), res.perServing, foods) : null;
  const dateOk = validDate(d.date);
  const save = (use: boolean) => {
    const r = kitchenTestFood(input, getRawIngredients());
    if (r.kind !== 'ok' && r.kind !== 'no-serving') return notify(problem(r));
    if (kitchenNoteTooLong(d.note)) return notify(NOTE_TOO_LONG);
    if (!dateOk) return notify(BAD_DATE);
    if (use && r.kind === 'ok') {
      store.save(d, r.name, r.food);
      notify(`Saved. ${r.name} now logs with your weighed values.`);
      return setD(null);
    }
    store.save(d, r.name, null);
    if (use) return notify('Weigh one serving first, so the app knows the portion.');
    notify('Kitchen test saved');
    setD(null);
  };
  const addPhoto = async (source: 'camera' | 'library') => {
    try {
      const jpeg = await capturePhoto(source);
      if (jpeg) {
        setD((x) => (x ? { ...x, photo: jpeg } : x));
        // Web: announceForAccessibility is a no-op in react-native-web; the label below is a live region instead.
        if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(PHOTO_ADDED);
      }
    } catch (e) {
      notify(e instanceof CameraDenied ? PHOTO_CAMERA_OFF : PHOTO_PICK_FAILED);
    }
  };
  const set = (patch: Partial<TestFields>) => setD({ ...d, ...patch });
  const how = showHow ?? store.tests.length === 0;

  return (
    <View style={styles.fill}>
      <Page>
        <H1>Kitchen test</H1>
        <Button label="How to do a kitchen test" kind="link" expanded={how} onPress={() => setShowHow(!how)} />
        {how ? (
          <View style={styles.gap}>
            {HOW_TO.map((s, i) => <Text key={i} style={{ color: c.ink }}>{`${i + 1}. ${s}`}</Text>)}
            <Hint>{HOW_TO_HINT}</Hint>
          </View>
        ) : null}
        <View style={styles.gap}>
          <Caption>Dish</Caption>
          <Field label="Dish" placeholder="e.g. Dal" value={d.name} onChangeText={(name) => set({ name })} />
          <Caption>Date</Caption>
          <Field label="Date" placeholder="2026-10-08" autoCapitalize="none" value={d.date} onChangeText={(date) => set({ date })} />
          {dateOk ? null : <ErrorText>{BAD_DATE}</ErrorText>}
          <Caption>Notes (who cooked, region, method)</Caption>
          <Field label="Notes (who cooked, region, method)" placeholder="e.g. Mom’s Punjabi-style, pressure cooker" value={d.note} onChangeText={(note) => set({ note })} />
        </View>
        <View style={styles.gap}>
          <Label>Raw ingredients</Label>
          <IngredientRows names={getShippedRawNames} rows={d.rows} onChange={(rows) => set({ rows })} />
        </View>
        <View style={styles.gap}>
          <View style={styles.wrap}>
            <View style={{ gap: 4, minWidth: 90, flexGrow: 1, maxWidth: 160 }}>
              <Caption>Empty pot (g)</Caption>
              <Field style={{ maxWidth: undefined }} label="Empty pot (g)" keyboardType="numeric" value={d.pot} onChangeText={(pot) => set({ pot })} />
            </View>
            <View style={{ gap: 4, minWidth: 90, flexGrow: 1, maxWidth: 160 }}>
              <Caption>Pot with food (g)</Caption>
              <Field style={{ maxWidth: undefined }} label="Pot with food (g)" keyboardType="numeric" value={d.potFull} onChangeText={(potFull) => set({ potFull })} />
            </View>
          </View>
          <View style={{ gap: 4 }}>
            <Caption>Or cooked weight directly (g)</Caption>
            <Field label="Or cooked weight directly (g)" keyboardType="numeric" value={d.cooked} onChangeText={(cooked) => set({ cooked })} />
          </View>
          <View style={{ gap: 4 }}>
            <Caption>One serving (g)</Caption>
            <Field label="One serving (g)" keyboardType="numeric" value={d.serving} onChangeText={(serving) => set({ serving })} />
          </View>
          <Label>Serving is a</Label>
          <View style={styles.wrap}>{SERVING_NAMES.map((n) => <Chip key={n} label={n} pressed={d.sname === n} onPress={() => set({ sname: n })} />)}</View>
        </View>
        <View accessibilityLiveRegion="polite" style={styles.gap}>
          {res.ready ? (
            <>
              <Text style={{ color: c.ink }}>{`Cooked weight: ${fmt(res.cooked_g)} g${res.servings ? `, about ${r1(res.servings)} servings` : ''}. Per 100 g: ${fmt(res.per100g.kcal)} kcal, ${r1(res.per100g.protein_g)} g protein, ${r1(res.per100g.carbs_g)} g carbs, ${r1(res.per100g.fat_g)} g fat.`}</Text>
              {res.perServing ? (
                <>
                  <Text style={{ color: c.ink, fontWeight: '700' }}>{`Per ${d.sname} (${fmt(res.perServing.grams)} g): ${fmt(res.perServing.kcal)} kcal, ${r1(res.perServing.protein_g)} g protein, ${r1(res.perServing.carbs_g)} g carbs, ${r1(res.perServing.fat_g)} g fat, ${r1(res.perServing.fibre_g)} g fibre`}</Text>
                  <Hint>{`Oil and ghee in each serving: about ${r1(res.perServing.oil_g)} g.`}</Hint>
                  {cmp ? <Hint>{compareLine(cmp)}</Hint> : null}
                </>
              ) : (
                <Hint>{NO_SERVING_HINT}</Hint>
              )}
            </>
          ) : (
            <Hint>{NOT_READY_HINT}</Hint>
          )}
        </View>
        <View style={styles.gap}>
          <View testID="photo-status" accessibilityLiveRegion={Platform.OS === 'web' ? 'polite' : undefined}><Label>{d.photo ? PHOTO_ADDED : PHOTO_ADD}</Label></View>
          <View style={styles.wrap}>
            <Button label={d.photo ? 'Retake the serving photo' : 'Take a photo of the serving'} kind="ghost" onPress={() => void addPhoto('camera')} />
            <Button label={d.photo ? 'Choose another serving photo' : 'Choose a photo of the serving'} kind="ghost" onPress={() => void addPhoto('library')} />
          </View>
          <Hint>{persistent ? PHOTO_HINT : PHOTO_HINT_WEB}</Hint>
        </View>
        <View style={styles.wrap}>
          <Button label="Save test" onPress={() => save(false)} />
          <Button label="Save and use for my logging" kind="ghost" onPress={() => save(true)} />
          <Button label="Cancel" kind="link" onPress={() => setD(null)} />
        </View>
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 6, marginTop: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
