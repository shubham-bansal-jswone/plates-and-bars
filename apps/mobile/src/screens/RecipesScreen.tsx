import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { OIL_LEVEL, RECIPE_LOG_STEP, recipeFood, recipeTotals, stepRecipeLog, type OilLevel } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Field, Hint, H1, Label, Page, Press } from '../components/ui';
import { fmt } from '../format';
import type { WorkoutDb } from '../db/workouts';
import { MEALS } from '../food/types';
import { katoriG, library, presets, rawIngredients } from '../recipes/content';
import { CookMode } from '../recipes/CookMode';
import { NO_YIELD_HINT, OIL_HINT, OIL_LABELS, problem, RB_INTRO, UNITS_HINT } from '../recipes/copy';
import { blankDraft, fromLibrary, fromPreset, fromRecipe, type Draft } from '../recipes/draft';
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
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/**
 * The recipe builder (prototype `recipeBody`): saved recipes, home-style starting points, the 9-recipe library with
 * steps and cooking mode, the ingredient rows, per-katori nutrition, and save (to my foods, optionally logging it).
 * Every number and rule is core's.
 */
export function RecipesScreen({ db, onBack, onKitchen, now = () => new Date() }: Props) {
  const c = useTheme();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  const store = useRecipes({ db, now, notify });
  const [d, setD] = useState<Draft>(blankDraft);
  const [cooking, setCooking] = useState(false);
  if (!store.ready) return <Page><Hint>Loading…</Hint></Page>;

  const yieldFields = { yield_mode: d.ymode, katoris: d.katoris, cooked_g: d.grams };
  const t = recipeTotals({ ingredients: d.rows, ...yieldFields }, rawIngredients, katoriG);
  const save = (log: boolean) => {
    const r = recipeFood({ name: d.name, ingredients: d.rows, ...yieldFields }, rawIngredients, katoriG);
    if (r.kind !== 'ok') return notify(problem(r));
    store.save({ result: r, yield_mode: d.ymode, katoris: d.katoris, cooked_g: d.grams, oil: d.oil, editing: d.editing, log: log ? { meal: d.meal, qty: d.log } : null });
    notify(log ? `Saved, and added ${r1(d.log)} katori of ${r.name}` : `Saved ${r.name} to your foods`);
    setD(blankDraft());
  };
  const back = () => void store.idle().then(onBack);
  const steps = d.lib?.steps ?? [];

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
            {presets.map((p) => <Chip key={p.name} label={p.name} pressed={d.preset === p} onPress={() => setD(fromPreset(d, p, d.oil, !!d.editing && !!d.name))} />)}
            <Chip label="Blank" onPress={() => setD(blankDraft())} />
          </View>
        </View>
        <View style={styles.gap}>
          <Label>Recipe library</Label>
          <View style={styles.wrap}>{library.map((l) => <Chip key={l.name} label={l.name} pressed={d.lib === l} onPress={() => setD(fromLibrary(d, l))} />)}</View>
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
        <View style={styles.gap}>
          <Label>Recipe name</Label>
          <Field label="Recipe name" placeholder="e.g. Mom’s dal" value={d.name} onChangeText={(name) => setD({ ...d, name })} />
        </View>
        <View style={styles.gap}>
          <Label>Ingredients (raw amounts)</Label>
          <IngredientRows rows={d.rows} onChange={(rows) => setD({ ...d, rows })} />
          <Hint>{UNITS_HINT}</Hint>
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
              <Text style={{ color: c.ink, fontWeight: '700' }}>{`Per katori (about ${katoriG} g cooked): ${fmt(t.perKatori.kcal)} kcal, ${fmt(t.perKatori.protein_g)} g protein, ${fmt(t.perKatori.carbs_g)} g carbs, ${fmt(t.perKatori.fat_g)} g fat`}</Text>
              <Hint>{`Makes about ${r1(t.katoris)} katoris.`}</Hint>
            </>
          ) : (
            <Hint>{NO_YIELD_HINT}</Hint>
          )}
        </View>
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
          <Button label="Kitchen tests" kind="ghost" onPress={() => void store.idle().then(onKitchen)} />
          <Button label="Back" kind="link" onPress={back} />
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
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
