import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { combos, combosFast, ideasPage, IDEAS_KCAL_LEFT_MIN, nextMealInfo, type MealDiet, type MealIdea, type NextMeal } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Button, Card, Choice, Hint, Note, Press } from '../components/ui';
import { fmt } from '../format';
import { catalogFoods, type CatalogFood } from '../food/catalog';
import type { FoodLog } from '../food/types';
import { radius, space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { mealPlanning } from './content';
import { DIET_CHIPS, DIET_WORDS, FLEX_HINT, NO_IDEAS, PLATE_GUIDE, PLATE_HINT, PROTEIN_HARD, REACHED } from './copy';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const label = (i: MealIdea<CatalogFood>): string => i.items.map((x) => `${x.food.name}${x.qty !== 1 ? ` ×${r1(x.qty)}` : ''}`).join(' + ');

interface Props {
  today: string;
  hour: number;
  logs: readonly FoodLog[];
  totals: { kcal: number; protein_g: number; fat_g: number };
  kcalTarget: number;
  proteinTarget: number;
  fatTarget: number;
  age: number | null | undefined;
  diet: MealDiet;
  fasting: boolean;
  onDiet: (d: MealDiet) => void;
  onFasting: (on: boolean) => void;
  /** Logs every item of the idea under the meal. */
  onAdd: (meal: NextMeal['meal'], items: { food: CatalogFood; qty: number }[]) => void;
  /** Plans a bigger day: the extra kcal for today. */
  onFlex: (extra: number) => void;
}

/** "What should I eat next?": the next meal's targets, three ideas at a time, the bigger-day chips and the plate guide. Nothing here is computed in the app: core's `nextMealInfo`, `combos`, `combosFast` and `ideasPage` decide. */
export function IdeasCard(p: Props) {
  const c = useTheme();
  const { fasting, diet } = p;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [flexOpen, setFlexOpen] = useState(false);
  const [plateOpen, setPlateOpen] = useState(false);
  const info = nextMealInfo({
    date: p.today,
    today: p.today,
    hour: p.hour,
    logs: p.logs,
    totals: p.totals,
    kcalTarget: p.kcalTarget,
    proteinTarget: p.proteinTarget,
    fatTarget: p.fatTarget,
    age: p.age,
    planning: mealPlanning,
  });
  const meal = info?.meal;
  const kcal = info?.kcal;
  const protein = info?.protein_g;
  const fat = info?.fat_g;
  const fits = info !== null && info.kcalLeft > IDEAS_KCAL_LEFT_MIN;
  // Built only while the card is open, and only when something is left to eat.
  let all: MealIdea<CatalogFood>[] = [];
  if (open && fits && meal !== undefined && kcal !== undefined && protein !== undefined) {
    const target = { meal, kcal, protein_g: protein, fat_g: fat };
    all = fasting ? combosFast(target, { foods: catalogFoods }) : combos(target, { foods: catalogFoods, planning: mealPlanning, diet });
  }
  if (!info || !meal) return null;
  const pg = ideasPage(all, page, info);
  const setDiet = (d: MealDiet) => {
    setPage(0);
    p.onDiet(d);
  };

  return (
    <Card>
      <Press accessibilityRole="button" accessibilityLabel={`What should I eat next? ${meal} ideas`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.head}>
        <View style={styles.fill}>
          <Hint>What should I eat next?</Hint>
          <Text style={[type.bodyStrong, { color: c.ink }]}>{`${meal} ideas`}</Text>
        </View>
        <Hint>{open ? 'Hide' : 'Show'}</Hint>
      </Press>
      {open ? (
        <View style={styles.body}>
          {!fits ? (
            <Text style={{ color: c.ink }}>{REACHED}</Text>
          ) : (
            <>
              <View style={styles.wrap}>
                {DIET_CHIPS.map((d) => <Choice key={d.key} chip label={d.label} selected={p.diet === d.key} onPress={() => setDiet(d.key)} />)}
                <FastChip on={p.fasting} onPress={() => { setPage(0); p.onFasting(!p.fasting); }} />
              </View>
              <Hint>{`About ${fmt(info.kcal)} kcal and ${fmt(info.protein_g)} g protein fits ${meal.toLowerCase()}, based on what’s left today. Showing ${DIET_WORDS[p.diet]}.`}</Hint>
              {pg.ideas.map((i, k) => (
                <View key={`${k}-${label(i)}`} style={[styles.combo, { borderColor: c.line }]}>
                  <View style={styles.fill}>
                    <Text style={{ color: c.ink, fontWeight: '600' }}>{label(i)}</Text>
                    <Hint>{`${fmt(i.kcal)} kcal, ${fmt(i.protein_g)} g protein`}</Hint>
                  </View>
                  <Button label="Add" a11yLabel={`Add ${label(i)} to ${meal.toLowerCase()}`} kind="ghost" onPress={() => p.onAdd(meal, i.items)} />
                </View>
              ))}
              {pg.ideas.length === 0 ? <Hint>{NO_IDEAS}</Hint> : null}
              {pg.proteinHard ? <Note>{PROTEIN_HARD}</Note> : null}
              {pg.pages > 1 ? <Button label={`More ideas (${pg.page + 1} of ${pg.pages})`} kind="ghost" onPress={() => setPage(pg.page + 1)} /> : null}
            </>
          )}
          <Button label="Plan a bigger day" kind="ghost" expanded={flexOpen} onPress={() => setFlexOpen(!flexOpen)} />
          {flexOpen ? (
            <>
              <View style={styles.wrap}>
                {[300, 500, 800].map((x) => <Button key={x} label={`+${x} kcal today`} kind="ghost" onPress={() => { setFlexOpen(false); p.onFlex(x); }} />)}
              </View>
              <Hint>{FLEX_HINT}</Hint>
            </>
          ) : null}
          <Button label="The thali plate guide" kind="link" expanded={plateOpen} onPress={() => setPlateOpen(!plateOpen)} />
          {plateOpen ? (
            <View style={styles.plate}>
              {/* TODO(#252): draw the plate (half protein, a quarter fat, a quarter carbs as in the prototype) once react-native-svg is on main. */}
              {PLATE_GUIDE.map(([b, t]) => <Text key={b + t} style={{ color: c.ink }}><Text style={styles.b}>{b} </Text>{t}</Text>)}
              <Hint>{PLATE_HINT}</Hint>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function FastChip({ on, onPress }: { on: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Press accessibilityRole="checkbox" accessibilityLabel="Fasting day" accessibilityState={{ checked: on }} aria-checked={on} onPress={onPress} hitSlop={{ top: 6, bottom: 6 }} style={[styles.chip, { backgroundColor: on ? c.brand : c.surfaceSoft }]}>
      <Text style={[type.buttonSm, { color: on ? c.onBrand : c.ink }]}>Fasting day</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  body: { gap: space.sm, marginTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  combo: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderRadius: 12 },
  chip: { borderRadius: radius.full, paddingHorizontal: space.md, minHeight: 32, justifyContent: 'center' },
  plate: { gap: 4, marginTop: 8 },
  b: { fontWeight: '700' },
});
