import { useRouter } from 'expo-router';
import { WhyLink } from '../why/WhyLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDataVersion } from '../sync/useDataVersion';
import { useStepsVersion } from '../steps/DeviceStepsProvider';
import { Text } from '../components/Text';
import { checkinBannerDue, DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET, DEFAULT_PROTEIN_TARGET, fibreTarget, flexPlanFor, flexToast, FRUIT_VEG_TARGET, fruitVegServings, kcalTarget, logPrep, logTotals, mealByTime, planFlex, planForMeal, prepFor, proteinUpgrade, showAddedSugar, undoFlex, type FoodFacts, type PlanItem, type PrepEntry, type ProteinUpgrade } from '@plate-and-bar/core';
import { fmt } from '../format';
import { a11yState, Heading, Button, Card, ErrorText, H1, Hint, Note, Page, Press } from '../components/ui';
import { newId } from '../db/records';
import { DateAnnouncer, DateBar } from '../components/DateBar';
import { useViewedDate } from '../state/ViewedDate';
import type { WorkoutDb } from '../db/workouts';
import { AddSheet } from '../food/AddSheet';
import { CHECKIN_READY, CHECKIN_SEE, lowProtein, PLAN_ITEM_GONE, plannedLogged, prepLine, prepLogged, SETUP_BANNER, toastMs, upgradeAdded } from '../food/copy';
import { getCuisines, getFoodCatalog, type CatalogFood } from '../food/catalog';
import { MEALS, type FoodLog, type Meal } from '../food/types';
import type { Mode } from '../food/AddSheet';
import { logOf, useFoodDay } from '../food/useFoodDay';
import { DIET_CHIPS } from '../meals/copy';
import { getMealPlanning } from '../meals/content';
import { IdeasCard } from '../meals/IdeasCard';
import { useWater } from '../food/useWater';
import { useLabHold } from '../labs/useLabHold';
import { BurnCard } from '../food/BurnCard';
import { WaterCard } from '../food/WaterCard';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';
import { usePendingToast } from '../state/pendingToast';
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
  const { ready: settingsReady, settings, loadFailed, setFlex, setDiet, update } = useSettings();
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [addMode, setAddMode] = useState<Mode>('list');
  const [describing, setDescribing] = useState<Meal | null>(null);
  const ai = useAi();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), toastMs(msg));
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  usePendingToast(notify);
  const dataVersion = useDataVersion() + useStepsVersion(); // a pulled record or a phone step reading changed a day note
  const v = useViewedDate(now);
  const f = useFoodDay({ db, date: v.date, now, notify, reloadKey: dataVersion });
  const water = useWater({ db, date: f.date, now, profile, adjustments: settings.adjustments, notify, reloadKey: dataVersion });
  const labHold = useLabHold(db); // the lab hold (#1070): the target is held at maintenance at least, and flex is ignored

  if (f.failed && !f.ready) return <Page><ErrorText>Couldn’t read your saved food. Restart the app to try again.</ErrorText></Page>;
  if (status !== 'ready' || !settingsReady || !f.ready || labHold === null) return <View style={styles.fill}><DateAnnouncer v={v} /><Page>{/* the same key as the loaded tree's bar, so it is not remounted when the day loads */}<DateBar key="date-bar" v={v} /><Hint>Loading…</Hint></Page></View>;

  const target = kcalTarget(f.date, { flex: settings.flex, labHold }, profile);
  // Shared foods, then eat-out dishes, then the user's foods: the first of a name with fibre data wins (prototype `FIB` before `myFoods`, #151).
  const facts: FoodFacts[] = [...getFoodCatalog(), ...getCuisines().flatMap((c) => c.dishes), ...f.mineFacts];
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
    const r = planFlex({ extra, date: f.date, today: v.today, id: newId(), flex: settings.flex, labHold }, profile);
    setFlex(r.flex);
    notify(flexToast(extra, r));
  };
  const undo = (id: string) => {
    if (!blocked()) setFlex(undoFlex(settings.flex, id, { profile, labHold }));
  };

  /** A plan item's food by name: My foods first, as the prototype's foodByName does; undefined when it is gone. */
  const findFood = (n: string): CatalogFood | undefined =>
    f.mine.map((u, i) => ({ ...f.mineFacts[i]!, id: u.id }) as CatalogFood).find((x) => x.name.toLowerCase() === n.toLowerCase()) ??
    getFoodCatalog().find((x) => x.name.toLowerCase() === n.toLowerCase());
  const logPlanned = (meal: Meal, items: PlanItem[]) => {
    const skipped: string[] = [];
    for (const [n, q] of items) {
      const food = findFood(n);
      if (food) f.add(meal, logOf(food, q));
      else skipped.push(n); // a plan item holds no nutrition of its own, so one gone from the catalog cannot be logged
    }
    notify(plannedLogged(meal, skipped, items.length - skipped.length));
  };

  /** "Log 1 katori": logs one portion of the batch and takes it off the batch, in the settings write queue (nothing waits on the network). */
  const logPrepared = (meal: Meal, id: string) => {
    if (blocked()) return;
    // Nothing left to log on the copy shown (a fast second tap on the last portion): no write, so Settings is not touched for nothing.
    if (!logPrep(settings.prep, id)) return;
    let done: PrepEntry | undefined;
    // The updater also runs when the write is made, on the stored record: only its first run, here, decides what is logged.
    const ok = update((s) => {
      const r = logPrep(s.prep, id);
      if (!r) return {};
      done ??= r.entry;
      return { prep: r.prep };
    });
    if (!ok || !done) return;
    f.add(meal, { name: done.name, qty: 1, kcal: done.food.kcal, protein_g: done.food.protein_g, carbs_g: done.food.carbs_g, fat_g: done.food.fat_g });
    notify(prepLogged(done.name));
  };

  // The add-on's room is the base target less what is eaten (prototype `S.settings.kcal`), not the shown target with flex days and the lab hold.
  const baseTarget = kcalTarget(f.date, { flex: [] }, profile);
  // Core's add-on is for today only: on a past day it returns null.
  const upgradeFor = (meal: Meal): ProteinUpgrade<CatalogFood> | null =>
    proteinUpgrade({ meal, date: f.date, today: v.today, items: f.logs.filter((l) => l.meal === meal), kcalLeft: baseTarget - t.kcal, foods: getFoodCatalog(), planning: getMealPlanning(), diet: settings.diet });

  return (
    <View style={styles.fill}>
      <DateAnnouncer v={v} />
      <Page>
        <H1>Food</H1>
        <DateBar key="date-bar" v={v} />
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
              <WhyLink id="fibre" values={{ fibre_g: fibreTarget(target) }} />
              <Text style={{ color: c.ink }}><Text style={styles.b}>Fruit & veg </Text>{`${r1(fruitVegServings(f.logs, facts))} of ${FRUIT_VEG_TARGET} servings`}</Text>
              {showAddedSugar(t) ? <Text style={{ color: c.ink }}><Text style={styles.b}>Added sugar </Text>{`${fmt(t.added_sugar_g)} g`}</Text> : null}
            </View>
            {t.withoutFibre ? <Hint>{`${t.withoutFibre} item${t.withoutFibre > 1 ? 's' : ''} without fibre data (photo estimates or custom foods) aren’t counted.`}</Hint> : null}
          </View>
        ) : (
          <View style={styles.gap}>
            <Hint>Nothing logged for this day yet. Add food under a meal, or copy the previous day if you ate the same things.</Hint>
            <Button label="Copy previous day" kind="link" onPress={() => void f.copyPrevious()} />
          </View>
        )}
        {todaysFlex.length ? (
          <View style={styles.gap}>
            <Note>{todaysPlan ? `Today’s target includes +${todaysPlan.kcal_delta} kcal for a bigger meal, balanced over the next few days.` : `Today’s target is ${-flexDelta} kcal lower to balance an earlier bigger day.`}</Note>
            {todaysPlan ? <Button label="Undo" a11yLabel="Undo bigger day" kind="link" onPress={() => undo(todaysPlan.id)} /> : null}
          </View>
        ) : null}
        {checkinBannerDue({ date: f.date, today: v.today, seen: settings.checkin_seen }) ? (
          <View style={[styles.banner, { backgroundColor: c.tint }]}>
            <Text style={{ color: c.ink, flex: 1 }}>{CHECKIN_READY}</Text>
            <Button label={CHECKIN_SEE} a11yLabel="See it: your weekly check-in" onPress={() => router.navigate('/progress' as never)} />
          </View>
        ) : null}
        <IdeasCard
          date={f.date}
          today={v.today}
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
        {profile ? <BurnCard db={db} date={f.date} profile={profile} steps={f.note?.steps ?? null} sleep={f.note?.sleep ?? null} onSaveStepsSleep={f.saveStepsSleep} kcalEaten={t.kcal} reloadKey={dataVersion} /> : (
          <View style={[styles.banner, { backgroundColor: c.tint }]}>
            <Text style={{ color: c.ink, flex: 1 }}>{SETUP_BANNER}</Text>
            <Button label="Start setup" onPress={() => router.push('/setup' as never)} />
          </View>
        )}
        {water.target && water.ready ? <WaterCard ml={water.ml} count={water.count} target={water.target} sizes={settings.water_sizes} profile={profile} onAdd={water.add} onUndo={water.undo} /> : null}
        {ai.available('meal_photo') ? (
          <View style={styles.snap}>
            <Button label={AI_COPY.photoSnap} a11yLabel={AI_COPY.photoSnap} onPress={() => { setAddMode('photo'); setAdding(mealByTime(now().getHours())); }} />
            <Hint>{AI_COPY.photoSnapHint}</Hint>
          </View>
        ) : null}
        {MEALS.map((m) => (
          <MealSection key={m} meal={m} items={f.logs.filter((l) => l.meal === m)} facts={facts} prep={prepFor(settings.prep, m, f.date)} onLogPrep={(id) => logPrepared(m, id)} upgrade={upgradeFor(m)} onUpgrade={(u) => { f.add(m, logOf(u.food, u.qty)); notify(upgradeAdded(u.food.name)); }} planned={planForMeal(settings.meal_plan, f.date, m)} onLogPlanned={logPlanned} known={(n) => !!findFood(n)} onRemove={f.remove} onAdd={() => { setAddMode('list'); setAdding(m); }} onDescribe={ai.available('describe_meal') ? () => setDescribing(m) : undefined} onRecipes={() => router.push({ pathname: '/recipes', params: { meal: m } })} />
        ))}
        {f.logs.length ? (
          <Press accessibilityRole="checkbox" accessibilityLabel="I’ve logged everything I ate today" {...a11yState({ checked: complete })} onPress={() => f.setComplete(!complete)} style={styles.check}>
            <View style={[styles.box, { borderColor: c.brand, backgroundColor: complete ? c.brand : 'transparent' }]}>{complete ? <Text style={{ color: c.onBrand, fontWeight: '700' }}>✓</Text> : null}</View>
            <Text style={{ color: c.ink, flex: 1 }}>I’ve logged everything I ate today <Text style={{ color: c.muted }}>(only complete days are used for your real calorie burn)</Text></Text>
          </Press>
        ) : null}
      </Page>
      {adding ? <AddSheet meal={adding} mine={f.mine} mineFacts={f.mineFacts} onAdd={(n) => f.add(adding, n)} onSaveMine={f.saveMine} onClose={() => setAdding(null)} canDescribe={ai.available('describe_meal')} canPhoto={ai.available('meal_photo')} initialMode={addMode} onToast={notify} /> : null}
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

function MealSection({ meal, items, facts, prep, onLogPrep, upgrade, onUpgrade, planned, onLogPlanned, known, onRemove, onAdd, onDescribe, onRecipes }: { meal: Meal; items: FoodLog[]; facts: FoodFacts[]; prep: PrepEntry[]; onLogPrep: (id: string) => void; upgrade: ProteinUpgrade<CatalogFood> | null; onUpgrade: (u: ProteinUpgrade<CatalogFood>) => void; planned: PlanItem[] | null; onLogPlanned: (meal: Meal, items: PlanItem[]) => void; known: (name: string) => boolean; onRemove: (id: string) => void; onAdd: () => void; onDescribe?: () => void; onRecipes: () => void }) {
  const c = useTheme();
  const kcal = logTotals(items, facts).kcal;
  return (
    <View style={styles.gap}>
      <View style={styles.between}>
        <Heading level={2} style={{ color: c.ink, fontWeight: '600', fontSize: 18 }}>{meal}</Heading>
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
          {/* An item gone from the food list cannot be logged: say so here, and offer Log it only when something can be (#434). */}
          <Text style={{ color: c.ink, flex: 1 }}>{`From your plan: ${planned.map(([n, q]) => `${n}${q !== 1 ? ` ×${r1(q)}` : ''}${known(n) ? '' : ` ${PLAN_ITEM_GONE}`}`).join(' + ')}`}</Text>
          {planned.some(([n]) => known(n)) ? <Button label="Log it" a11yLabel={`Log your planned ${meal.toLowerCase()}`} kind="ghost" onPress={() => onLogPlanned(meal, planned)} /> : null}
        </View>
      ) : null}
      {prep.map((p) => (
        <View key={p.id} style={styles.between}>
          <Text style={{ color: c.ink, flex: 1 }}>{prepLine(p.name, p.left)}</Text>
          <Button label="Log 1 katori" a11yLabel={`Log 1 katori of ${p.name} to ${meal.toLowerCase()}`} kind="ghost" onPress={() => onLogPrep(p.id)} />
        </View>
      ))}
      {upgrade ? (
        <View style={styles.between}>
          <View style={styles.fill}>
            <Text style={{ color: c.ink }}>{lowProtein(upgrade.label, upgrade.protein_g, upgrade.kcal)}</Text>
            <WhyLink id="protein" subject={`low protein in ${meal.toLowerCase()}`} />
          </View>
          <Button label="Add" a11yLabel={`Add ${upgrade.label} to ${meal.toLowerCase()}`} kind="ghost" onPress={() => onUpgrade(upgrade)} />
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
  snap: { gap: 6, marginTop: 14 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, borderRadius: radius.md },
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
