import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDataVersion } from '../sync/useDataVersion';
import { Text } from '../components/Text';
import { DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET, DEFAULT_PROTEIN_TARGET, fibreTarget, flexPlanFor, flexToast, FRUIT_VEG_TARGET, fruitVegServings, kcalTarget, logTotals, planFlex, planForMeal, showAddedSugar, undoFlex, type FoodFacts, type PlanItem } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Button, Card, ErrorText, H1, Hint, Note, Page, Press } from '../components/ui';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { AddSheet } from '../food/AddSheet';
import { getFoodCatalog, type CatalogFood } from '../food/catalog';
import { MEALS, type FoodLog, type Meal } from '../food/types';
import { logOf, useFoodDay } from '../food/useFoodDay';
import { DIET_CHIPS } from '../meals/copy';
import { IdeasCard } from '../meals/IdeasCard';
import { useWater } from '../food/useWater';
import { WaterCard } from '../food/WaterCard';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';
import { useAi } from '../ai/AiProvider';
import { DescribeSheet } from '../ai/DescribeSheet';
import { AI_COPY } from '../ai/copy';

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Food tab: today's calories and macros, fibre row, the four meals, and the add-food sheet. */
export function FoodScreen({ db, now = () => new Date() }: Props) {
  const c = useTheme();
  const router = useRouter();
  const { profile, status } = useProfile();
  const { ready: settingsReady, settings, loadFailed, setFlex, setDiet } = useSettings();
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [describing, setDescribing] = useState<Meal | null>(null);
  const ai = useAi();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const f = useFoodDay({ db, now, notify, reloadKey: useDataVersion() });
  const water = useWater({ db, date: f.date, now, profile, notify });

  if (f.failed && !f.ready) return <Page><ErrorText>Couldn’t read your saved food. Restart the app to try again.</ErrorText></Page>;
  if (status !== 'ready' || !settingsReady || !f.ready) return <Page><Hint>Loading…</Hint></Page>;

  // TODO(#219): the lab hold is not stored yet, so it is off for the target and for planning a flex.
  const target = kcalTarget(f.date, { flex: settings.flex }, profile);
  const facts: FoodFacts[] = [...getFoodCatalog(), ...f.mineFacts];
  const t = logTotals(f.logs, facts);
  const left = target - t.kcal;
  const complete = f.note?.complete === true;
  const todaysFlex = settings.flex.filter((x) => x.date === f.date);
  const flexDelta = todaysFlex.reduce((a, x) => a + x.kcal_delta, 0);
  const todaysPlan = flexPlanFor(settings.flex, f.date);
  const blocked = (): boolean => {
    if (loadFailed) notify('Couldn’t read your saved settings, so changes are not saved. Restart the app to try again.');
    return loadFailed;
  };
  const plan = (extra: number) => {
    if (blocked()) return;
    const r = planFlex({ extra, date: f.date, today: f.date, id: newId(), flex: settings.flex }, profile);
    setFlex(r.flex);
    notify(flexToast(extra, r));
  };
  const undo = (id: string) => {
    // TODO(#219): labHold is off until the lab hold is stored.
    if (!blocked()) setFlex(undoFlex(settings.flex, id, { profile }));
  };

  const logPlanned = (meal: Meal, items: PlanItem[]) => {
    for (const [n, q] of items) {
      // My foods first, as the prototype's foodByName does.
      const mineFood = f.mine.map((u, i) => ({ ...f.mineFacts[i]!, id: u.id }) as CatalogFood).find((x) => x.name.toLowerCase() === n.toLowerCase());
      const food = mineFood ?? getFoodCatalog().find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (food) f.add(meal, logOf(food, q));
    }
    notify(`Logged your planned ${meal.toLowerCase()}`);
  };

  return (
    <View style={styles.fill}>
      <Page>
        <H1>Food</H1>
        <View accessibilityRole="summary" accessibilityLabel={`${fmt(t.kcal)} of ${fmt(target)} kcal eaten`} style={styles.gap}>
          <Text style={{ color: left < 0 ? c.caution : c.ink, fontSize: 40, fontWeight: '300' }}>{fmt(Math.abs(left))}</Text>
          <Text style={{ color: c.body }}>{left < 0 ? 'kcal over' : 'kcal left'}</Text>
          <Text style={{ color: c.ink }}>{`${fmt(t.kcal)} of ${fmt(target)} kcal eaten`}</Text>
        </View>
        <Macro name="Protein" v={t.protein_g} goal={profile?.targets.protein_g ?? DEFAULT_PROTEIN_TARGET} color={c.protein} />
        <Macro name="Carbs" v={t.carbs_g} goal={profile?.targets.carbs_g ?? DEFAULT_CARBS_TARGET} color={c.carbs} />
        <Macro name="Fat" v={t.fat_g} goal={profile?.targets.fat_g ?? DEFAULT_FAT_TARGET} color={c.fat} />
        {f.logs.length ? (
          <View style={styles.gap}>
            <View style={styles.wrap}>
              <Text style={{ color: c.ink }}><Text style={styles.b}>Fibre </Text>{`${fmt(t.fibre_g)} of ${fibreTarget(target)} g`}</Text>
              <Text style={{ color: c.ink }}><Text style={styles.b}>Fruit & veg </Text>{`${r1(fruitVegServings(f.logs, facts))} of ${FRUIT_VEG_TARGET} servings`}</Text>
              {showAddedSugar(t) ? <Text style={{ color: c.ink }}><Text style={styles.b}>Added sugar </Text>{`${fmt(t.added_sugar_g)} g`}</Text> : null}
            </View>
            {t.withoutFibre ? <Hint>{`${t.withoutFibre} item${t.withoutFibre > 1 ? 's' : ''} without fibre data (photo estimates or custom foods) aren’t counted.`}</Hint> : null}
          </View>
        ) : (
          <Hint>Nothing logged for this day yet. Add food under a meal.</Hint>
        )}
        {todaysFlex.length ? (
          <View style={styles.gap}>
            <Note>{todaysPlan ? `Today’s target includes +${todaysPlan.kcal_delta} kcal for a bigger meal, balanced over the next few days.` : `Today’s target is ${-flexDelta} kcal lower to balance an earlier bigger day.`}</Note>
            {todaysPlan ? <Button label="Undo" a11yLabel="Undo bigger day" kind="link" onPress={() => undo(todaysPlan.id)} /> : null}
          </View>
        ) : null}
        <IdeasCard
          today={f.date}
          hour={now().getHours()}
          logs={f.logs}
          totals={t}
          kcalTarget={target}
          proteinTarget={profile?.targets.protein_g ?? DEFAULT_PROTEIN_TARGET}
          fatTarget={profile?.targets.fat_g ?? DEFAULT_FAT_TARGET}
          age={profile?.age}
          diet={settings.diet}
          fasting={f.note?.fast === true}
          onDiet={(d) => {
            if (blocked()) return;
            setDiet(d);
            notify(`${DIET_CHIPS.find((x) => x.key === d)?.label ?? d} ideas`);
          }}
          onFasting={f.setFast}
          onAdd={(meal, items) => {
            items.forEach((i) => f.add(meal, logOf(i.food, i.qty)));
            notify(`Added to ${meal.toLowerCase()}`);
          }}
          onFlex={plan}
          onPlanWeek={() => router.push('/meal-plan')}
        />
        {water.target ? <WaterCard ml={water.ml} count={water.count} target={water.target} sizes={settings.water_sizes} profile={profile} onAdd={water.add} onUndo={water.undo} /> : null}
        {MEALS.map((m) => (
          <MealSection key={m} meal={m} items={f.logs.filter((l) => l.meal === m)} facts={facts} planned={planForMeal(settings.meal_plan, f.date, m)} onLogPlanned={logPlanned} onRemove={f.remove} onAdd={() => setAdding(m)} onDescribe={ai.available('describe_meal') ? () => setDescribing(m) : undefined} onRecipes={() => router.push({ pathname: '/recipes', params: { meal: m } })} />
        ))}
        {f.logs.length ? (
          <Press accessibilityRole="checkbox" accessibilityLabel="I’ve logged everything I ate today" accessibilityState={{ checked: complete }} aria-checked={complete} onPress={() => f.setComplete(!complete)} style={styles.check}>
            <View style={[styles.box, { borderColor: c.brand, backgroundColor: complete ? c.brand : 'transparent' }]}>{complete ? <Text style={{ color: c.onBrand, fontWeight: '700' }}>✓</Text> : null}</View>
            <Text style={{ color: c.ink, flex: 1 }}>I’ve logged everything I ate today <Text style={{ color: c.muted }}>(only complete days are used for your real calorie burn)</Text></Text>
          </Press>
        ) : null}
      </Page>
      {adding ? <AddSheet meal={adding} mine={f.mine} mineFacts={f.mineFacts} onAdd={(n) => f.add(adding, n)} onSaveMine={f.saveMine} onClose={() => setAdding(null)} /> : null}
      {describing ? <DescribeSheet meal={describing} onAdd={(n) => f.add(describing, n)} onClose={() => setDescribing(null)} /> : null}
      <ToastBar message={toast} />
    </View>
  );
}

function Macro({ name, v, goal, color }: { name: string; v: number; goal: number; color: string }) {
  const c = useTheme();
  const left = goal - v;
  return (
    <View accessible accessibilityLabel={`${name} ${fmt(v)} of ${fmt(goal)} g, ${left >= 0 ? `${fmt(left)} g to go` : `${fmt(-left)} g over`}`} style={styles.gap}>
      <View style={styles.between}>
        <Text style={{ color: c.ink, fontWeight: '700' }}>{name}</Text>
        <Text style={{ color: c.muted }}>{`${fmt(v)} / ${fmt(goal)} g · ${left >= 0 ? `${fmt(left)} g to go` : `${fmt(-left)} g over`}`}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: c.track }]}><View style={{ height: 8, borderRadius: radius.full, backgroundColor: color, width: `${goal > 0 ? Math.min(100, (v / goal) * 100) : 0}%` }} /></View>
    </View>
  );
}

function MealSection({ meal, items, facts, planned, onLogPlanned, onRemove, onAdd, onDescribe, onRecipes }: { meal: Meal; items: FoodLog[]; facts: FoodFacts[]; planned: PlanItem[] | null; onLogPlanned: (meal: Meal, items: PlanItem[]) => void; onRemove: (id: string) => void; onAdd: () => void; onDescribe?: () => void; onRecipes: () => void }) {
  const c = useTheme();
  const kcal = logTotals(items, facts).kcal;
  return (
    <View style={styles.gap}>
      <View style={styles.between}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '600', fontSize: 18 }}>{meal}</Text>
        <Text style={{ color: c.muted }}>{items.length ? `${fmt(kcal)} kcal` : ''}</Text>
      </View>
      {items.map((m) => (
        <Card key={m.id} style={styles.item}>
          <View style={styles.fill}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{m.name}{m.qty !== 1 ? ` ×${r1(m.qty)}` : ''}</Text>
            <Text style={{ color: c.muted, fontSize: 14 }}>{`${fmt(m.protein_g * m.qty)} g protein, ${fmt(m.carbs_g * m.qty)} g carbs, ${fmt(m.fat_g * m.qty)} g fat`}</Text>
          </View>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(m.kcal * m.qty)}</Text>
          <Press accessibilityRole="button" accessibilityLabel={`Remove ${m.name}`} onPress={() => onRemove(m.id)} style={styles.x}><Text style={{ color: c.muted, fontSize: 22 }}>×</Text></Press>
        </Card>
      ))}
      {!items.length && planned?.length ? (
        <View style={[styles.between, styles.item]}>
          <Text style={{ color: c.ink, flex: 1 }}>{`From your plan: ${planned.map(([n, q]) => `${n}${q !== 1 ? ` ×${r1(q)}` : ''}`).join(' + ')}`}</Text>
          <Button label="Log it" a11yLabel={`Log your planned ${meal.toLowerCase()}`} kind="ghost" onPress={() => onLogPlanned(meal, planned)} />
        </View>
      ) : null}
      <Button label={`+ Add to ${meal.toLowerCase()}`} onPress={onAdd} kind="ghost" />
      {onDescribe ? <Button label={AI_COPY.describeButton} a11yLabel={`Describe your ${meal.toLowerCase()} in words, AI estimate`} onPress={onDescribe} kind="ghost" /> : null}
      <Button label="Recipes" a11yLabel={`Recipes for ${meal.toLowerCase()}: build a recipe, the library and cooking mode`} onPress={onRecipes} kind="link" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 4, marginTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  b: { fontWeight: '700' },
  track: { height: 8, borderRadius: radius.full, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginTop: 12 },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
