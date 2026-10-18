import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { addPrep, fitSuggestions, isPrepEntry, OIL_LEVEL, RECIPE_LOG_STEP, recipeFood, recipeTotals, stepRecipeLog, type OilLevel } from '@plate-and-bar/core';
import { localDate } from '../setup/logic';
import { useDataVersion } from '../sync/useDataVersion';
import { Text } from '../components/Text';
import { Button, Caption, ErrorText, Field, Hint, H1, Label, Note, Page, Press } from '../components/ui';
import { fmt } from '../format';
import { newId } from '../db/records';
import { useSettings } from '../state/SettingsProvider';
import type { WorkoutDb } from '../db/workouts';
import { MEALS, type Meal } from '../food/types';
import { getKatoriG, getLibrary, getPresets, getRawIngredients, getRawNames, unknownIngredients } from '../recipes/content';
import { ImportRecipe } from '../ai/ImportRecipe';
import { AI_COPY } from '../ai/copy';
import { CookMode } from '../recipes/CookMode';
import { FIT_LABEL, fitLine, LOAD_FAILED, NO_YIELD_HINT, OIL_HINT, OIL_LABELS, PREP_NOT_SAVED, prepSet, problem, RB_INTRO, UNITS_HINT, unknownBlock } from '../recipes/copy';
import { blankDraft, fromImport, fromLibrary, fromPreset, fromRecipe, withFit, type Draft } from '../recipes/draft';
import { IngredientRows } from '../recipes/IngredientRows';
import { useRecipes } from '../recipes/useRecipes';
import { useTheme } from '../theme/useTheme';
import { Chip, ToastBar } from '../workout/parts';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

interface Props {
  db: WorkoutDb;
  onBack: () => void;
  /** Opens the kitchen tests. */
  onKitchen: () => void;
  /** The meal Recipes was opened from; "Save and add" logs to it unless another is chosen. */
  meal?: Meal;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/**
 * The recipe builder (prototype `recipeBody`): saved recipes, home-style starting points, the 9-recipe library with
 * steps and cooking mode, the ingredient rows, per-katori nutrition, and save (to my foods, optionally logging it).
 * Every number and rule is core's.
 */
export function RecipesScreen({ db, onBack, onKitchen, meal = 'Lunch', now = () => new Date() }: Props) {
  const c = useTheme();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const { update, loadFailed } = useSettings();
  const store = useRecipes({ db, now, notify, reloadKey: useDataVersion() });
  const [d, setD] = useState<Draft>(() => blankDraft(meal));
  const leaving = useRef(false);
  const [cooking, setCooking] = useState(false);
  // Back and Kitchen tests wait for queued writes; a second press while waiting does nothing.
  const leave = (go: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    void store.idle().then(go, go);
  };
  if (store.failed) return <Page><ErrorText>{LOAD_FAILED}</ErrorText><Button label="Back" kind="link" onPress={() => leave(onBack)} /></Page>;
  if (!store.ready) return <Page><Hint>Loading…</Hint></Page>;

  const yieldFields = { yield_mode: d.ymode, katoris: d.katoris, cooked_g: d.grams };
  const t = recipeTotals({ ingredients: d.rows, ...yieldFields }, getRawIngredients(), getKatoriG());
  const fits = fitSuggestions({ ingredients: d.rows, ...yieldFields }, getRawIngredients(), getKatoriG());
  const save = (log: boolean) => {
    const unknown = unknownIngredients(d.rows);
    if (unknown.length) return notify(unknownBlock(unknown));
    const r = recipeFood({ name: d.name, ingredients: d.rows, ...yieldFields }, getRawIngredients(), getKatoriG());
    if (r.kind !== 'ok') return notify(problem(r));
    store.save({ result: r, yield_mode: d.ymode, katoris: d.katoris, cooked_g: d.grams, oil: d.oil, editing: d.editing, log: log ? { meal: d.meal, qty: d.log } : null });
    if (log) return leave(onBack);
    notify(`Saved ${r.name} to your foods`);
    setD(blankDraft(d.meal));
  };
  /** "Save as meal prep" (prototype `rb-prep`): saves the recipe as Save only does, then sets the batch; nothing is set when the recipe does not save. */
  const savePrep = () => {
    if (leaving.current) return; // a second tap before the screen has gone back
    const unknown = unknownIngredients(d.rows);
    if (unknown.length) return notify(unknownBlock(unknown));
    const r = recipeFood({ name: d.name, ingredients: d.rows, ...yieldFields }, getRawIngredients(), getKatoriG());
    if (r.kind !== 'ok' || !t.perKatori) return notify(r.kind !== 'ok' ? problem(r) : NO_YIELD_HINT);
    if (loadFailed) return notify(PREP_NOT_SAVED);
    const entryId = newId();
    const batch = { id: entryId, name: r.name, meal: d.meal, katoris: t.katoris, perKatori: t.perKatori, today: localDate(now()) };
    store.save({ result: r, yield_mode: d.ymode, katoris: d.katoris, cooked_g: d.grams, oil: d.oil, editing: d.editing, log: null });
    // The updater runs on the shown copy and again on the stored record: a batch already there (a replay) is not added twice.
    update((s) => (s.prep.some((p) => isPrepEntry(p) && p.id === entryId) ? {} : { prep: addPrep(s.prep, batch) }));
    notify(prepSet(Math.round(t.katoris), d.meal));
    leave(onBack);
  };
  const steps = d.lib?.steps ?? d.importedSteps;

  return (
    <View style={styles.fill}>
      <Page>
        <H1>Recipes</H1>
        {store.recipes.length ? (
          <View style={styles.gap}>
            <Label>Your recipes</Label>
            <View style={styles.wrap}>{store.recipes.map((r) => <Chip key={r.id} label={r.name} pressed={d.editing?.id === r.id} onPress={() => setD(fromRecipe(d, r))} />)}</View>
          </View>
        ) : null}
        <View style={styles.gap}>
          <Label>{RB_INTRO}</Label>
          <View style={styles.wrap}>
            {getPresets().map((p) => <Chip key={p.name} label={p.name} pressed={d.preset === p} onPress={() => setD(fromPreset(d, p, d.oil, !!d.editing && !!d.name))} />)}
            <Chip label="Blank" onPress={() => setD(blankDraft(meal))} />
          </View>
        </View>
        <View style={styles.gap}>
          <Label>Recipe library</Label>
          <View style={styles.wrap}>{getLibrary().map((l) => <Chip key={l.name} label={l.name} pressed={d.lib === l} onPress={() => setD(fromLibrary(d, l))} />)}</View>
          {d.lib ? <Hint>{`${d.lib.tags}, about ${d.lib.time_min} min, cost: ${d.lib.cost?.toLowerCase()}`}</Hint> : null}
        </View>
        {d.preset ? (
          <View style={styles.gap}>
            <Label>How much oil or ghee went in?</Label>
            <View style={styles.wrap}>
              {(Object.keys(OIL_LEVEL) as OilLevel[]).map((k) => <Chip key={k} label={OIL_LABELS[k]} pressed={d.oil === k} onPress={() => d.preset && setD(fromPreset(d, d.preset, k, true))} />)}
            </View>
            <Hint>{OIL_HINT}</Hint>
          </View>
        ) : null}
        <ImportRecipe known={new Set(getRawNames())} onDraft={(r) => { setD(fromImport(d, r)); notify(AI_COPY.importDone); }} />
        <View style={styles.gap}>
          <Caption>Recipe name</Caption>
          <Field label="Recipe name" placeholder="e.g. Mom’s dal" value={d.name} onChangeText={(name) => setD({ ...d, name })} />
        </View>
        <View style={styles.gap}>
          <Label>Ingredients (raw amounts)</Label>
          <IngredientRows rows={d.rows} onChange={(rows) => setD({ ...d, rows })} />
          <Hint>{UNITS_HINT}</Hint>
          {d.importedUnmatched.length ? <View accessibilityLiveRegion="polite"><Note>{AI_COPY.importUnmatched(d.importedUnmatched)}</Note></View> : null}
        </View>
        <View style={styles.gap}>
          <Label>How much did it make?</Label>
          <View style={styles.wrap}>
            <Chip label="Count katoris" pressed={d.ymode === 'katori'} onPress={() => setD({ ...d, ymode: 'katori' })} />
            <Chip label="I weighed the pot" pressed={d.ymode === 'grams'} onPress={() => setD({ ...d, ymode: 'grams' })} />
          </View>
          {d.ymode === 'katori' ? (
            <View style={styles.wrap}>
              <Field label="Number of katoris" keyboardType="decimal-pad" value={d.katoris} onChangeText={(katoris) => setD({ ...d, katoris })} />
              <Hint>katoris</Hint>
            </View>
          ) : (
            <View style={styles.wrap}>
              <Field label="Cooked weight in grams" keyboardType="numeric" value={d.grams} onChangeText={(grams) => setD({ ...d, grams })} />
              <Hint>grams cooked (without the pot)</Hint>
            </View>
          )}
        </View>
        <View accessibilityLiveRegion="polite" style={styles.gap}>
          <Hint>{`Whole pot: ${fmt(t.total.kcal)} kcal, ${fmt(t.total.protein_g)} g protein, ${fmt(t.total.carbs_g)} g carbs, ${fmt(t.total.fat_g)} g fat.`}</Hint>
          {t.perKatori ? (
            <>
              <Text style={{ color: c.ink, fontWeight: '700' }}>{`Per katori (about ${getKatoriG()} g cooked): ${fmt(t.perKatori.kcal)} kcal, ${fmt(t.perKatori.protein_g)} g protein, ${fmt(t.perKatori.carbs_g)} g carbs, ${fmt(t.perKatori.fat_g)} g fat`}</Text>
              <Hint>{`Makes about ${r1(t.katoris)} katoris.`}</Hint>
            </>
          ) : (
            <Hint>{NO_YIELD_HINT}</Hint>
          )}
        </View>
        {fits.length ? (
          <View style={styles.gap}>
            <Label>{FIT_LABEL}</Label>
            {fits.map((f) => (
              <View key={f.kind} style={styles.wrap}>
                <Text style={[styles.fitText, { color: c.ink }]}>{fitLine(f)}</Text>
                <Button label="Apply" kind="ghost" a11yLabel={`Apply: ${fitLine(f)}`} onPress={() => setD(withFit(d, f.kind))} />
              </View>
            ))}
          </View>
        ) : null}
        {steps.length ? (
          <View style={styles.gap}>
            <Label>Steps</Label>
            {steps.map((s, i) => <Text key={i} style={{ color: c.ink }}>{`${i + 1}. ${s}`}</Text>)}
            <View style={styles.wrap}><Button label="Cooking mode" kind="ghost" onPress={() => setCooking(true)} /></View>
          </View>
        ) : null}
        <View style={styles.gap}>
          <Label>Add to</Label>
          <View style={styles.wrap}>{MEALS.map((m) => <Chip key={m} label={m} pressed={d.meal === m} onPress={() => setD({ ...d, meal: m })} />)}</View>
          <View style={styles.wrap}>
            <Hint>Log now</Hint>
            <Press accessibilityRole="button" accessibilityLabel="Fewer katoris" onPress={() => setD({ ...d, log: stepRecipeLog(d.log, -RECIPE_LOG_STEP) })} style={styles.step}><Text style={{ color: c.ink, fontSize: 22 }}>−</Text></Press>
            <Text style={{ color: c.ink, fontWeight: '700' }}>{r1(d.log)}</Text>
            <Press accessibilityRole="button" accessibilityLabel="More katoris" onPress={() => setD({ ...d, log: stepRecipeLog(d.log, RECIPE_LOG_STEP) })} style={styles.step}><Text style={{ color: c.ink, fontSize: 22 }}>+</Text></Press>
            <Hint>katori</Hint>
          </View>
        </View>
        <View style={styles.wrap}>
          <Button label={`Save and add to ${d.meal.toLowerCase()}`} onPress={() => save(true)} />
          <Button label="Save only" kind="ghost" onPress={() => save(false)} />
          <Button label="Save as meal prep" a11yLabel={`Save as meal prep for ${d.meal.toLowerCase()}`} kind="ghost" onPress={savePrep} />
          <Button label="Kitchen tests" kind="ghost" onPress={() => leave(onKitchen)} />
          <Button label="Back" kind="link" onPress={() => leave(onBack)} />
        </View>
      </Page>
      {cooking ? <CookMode name={d.name} steps={steps} onClose={() => setCooking(false)} onDone={() => { setCooking(false); notify('Enjoy your meal'); }} /> : null}
      <ToastBar message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 6, marginTop: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  fitText: { flexShrink: 1, flexGrow: 1, flexBasis: 200 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
