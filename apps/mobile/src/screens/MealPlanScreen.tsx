import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { addDays, buildPlan, DEFAULT_KCAL_TARGET, DEFAULT_FAT_TARGET, DEFAULT_PROTEIN_TARGET, groceryList, MEAL_ORDER, planDayTotals, planIsCurrent, planItems, PLAN_DAYS, swapPlanMeal, type MealPlan } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, H1, Hint, Page, Press } from '../components/ui';
import { fmt } from '../format';
import { catalogFoods } from '../food/catalog';
import { mealGrocery, mealPlanning } from '../meals/content';
import { COPIED, COPY_FAILED, GROCERY_NOTE, PLAN_SAVED, planIntro } from '../meals/planCopy';
import { localDate } from '../setup/logic';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const dayName = (date: string): string => new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

interface Props {
  onBack: () => void;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

/** The week's meal plan (build, swap a meal, use it) and its grocery list with copy as text. The plan is core's; the draft is local until "Use this plan". */
export function MealPlanScreen(p: Props) {
  const { status } = useProfile();
  const { ready } = useSettings();
  if (status !== 'ready' || !ready) return <Page><Hint>Loading…</Hint></Page>;
  return <Plan {...p} />;
}

function Plan({ onBack, now = () => new Date() }: Props) {
  const c = useTheme();
  const { profile } = useProfile();
  const { settings, loadFailed, setMealPlan } = useSettings();
  const today = localDate(now());
  const targets = { kcal: profile?.targets.kcal ?? DEFAULT_KCAL_TARGET, protein: profile?.targets.protein_g ?? DEFAULT_PROTEIN_TARGET, fat: profile?.targets.fat_g ?? DEFAULT_FAT_TARGET };
  const build = (): MealPlan => buildPlan(targets, today, { foods: catalogFoods, planning: mealPlanning, diet: settings.diet });
  const [plan, setPlan] = useState<MealPlan>(() => (planIsCurrent(settings.meal_plan, today) && settings.meal_plan ? settings.meal_plan : build()));
  const [grocery, setGrocery] = useState(false);
  const [got, setGot] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const notify = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  };
  const use = () => {
    if (loadFailed) return notify('Couldn’t read your saved settings, so changes are not saved. Restart the app to try again.');
    setMealPlan(plan);
    notify(PLAN_SAVED);
    onBack();
  };

  if (grocery) {
    const list = groceryList(plan, mealGrocery);
    const copy = () => Clipboard.setStringAsync(list.text).then(() => notify(COPIED), () => notify(COPY_FAILED));
    return (
      <View style={styles.fill}>
        <Page>
          <H1>Grocery list for the week</H1>
          {list.rows.map((r) => {
            const k = `${r.item}|${r.unit}`;
            const on = got[k] === true;
            return (
              <Press key={k} accessibilityRole="checkbox" accessibilityLabel={`${r.item}, ${r.label}`} accessibilityState={{ checked: on }} aria-checked={on} onPress={() => setGot({ ...got, [k]: !on })} style={styles.row}>
                <View style={[styles.box, { borderColor: c.brand, backgroundColor: on ? c.brand : 'transparent' }]}>{on ? <Text style={{ color: c.onBrand, fontWeight: '700' }}>✓</Text> : null}</View>
                <Text style={{ color: c.ink, flex: 1 }}>{r.item}</Text>
                <Text style={{ color: c.ink, fontWeight: '700' }}>{r.label}</Text>
              </Press>
            );
          })}
          <Hint>{GROCERY_NOTE}</Hint>
          <View style={styles.wrap}>
            <Button label="Back to the plan" kind="ghost" onPress={() => setGrocery(false)} />
            <Button label="Copy as text" kind="ghost" onPress={copy} />
          </View>
        </Page>
        <ToastBar message={toast} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Page>
        <H1>Your week of meals</H1>
        <Hint>{planIntro(fmt(targets.kcal), targets.protein)}</Hint>
        {Array.from({ length: PLAN_DAYS }, (_, i) => {
          const name = dayName(addDays(plan.start, i));
          const tot = planDayTotals(plan, i, catalogFoods);
          return (
            <View key={i} style={[styles.day, { borderTopColor: c.line }]}>
              <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '600', fontSize: 18 }}>{name}</Text>
              {MEAL_ORDER.map((m) => (
                <View key={m} style={styles.between}>
                  <Text style={{ color: c.ink, flex: 1 }}>
                    <Text style={styles.b}>{m}: </Text>
                    {planItems(plan, i, m).map(([n, q]) => `${n}${q !== 1 ? ` ×${r1(q)}` : ''}`).join(' + ')}
                  </Text>
                  <Button label="Swap" a11yLabel={`Swap ${m} on ${name}`} kind="link" onPress={() => setPlan(swapPlanMeal(plan, i, m))} />
                </View>
              ))}
              <Hint>{`About ${fmt(tot.kcal)} kcal, ${fmt(tot.protein_g)} g protein`}</Hint>
            </View>
          );
        })}
        <View style={styles.wrap}>
          <Button label="Use this plan" onPress={use} />
          <Button label="Grocery list" kind="ghost" onPress={() => setGrocery(true)} />
          <Button label="Start over" kind="ghost" onPress={() => setPlan(build())} />
          <Button label="Back" kind="link" onPress={onBack} />
        </View>
      </Page>
      <ToastBar message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  between: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  day: { borderTopWidth: 1, paddingTop: 8, marginTop: 8, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  b: { fontWeight: '700' },
});
