import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DEFAULT_CARBS_TARGET, DEFAULT_FAT_TARGET, DEFAULT_PROTEIN_TARGET, fibreTarget, flexToast, FRUIT_VEG_TARGET, fruitVegServings, kcalTarget, logTotals, planFlex, showAddedSugar, undoFlex, type FoodFacts } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Button, H1, Hint, Note, Page } from '../components/ui';
import { newId } from '../db/records';
import type { WorkoutDb } from '../db/workouts';
import { AddSheet } from '../food/AddSheet';
import { catalogFoods } from '../food/catalog';
import { MEALS, type FoodLog, type Meal } from '../food/types';
import { useFoodDay } from '../food/useFoodDay';
import { useProfile } from '../state/ProfileProvider';
import { useSettings } from '../state/SettingsProvider';
import { useTheme } from '../theme/useTheme';
import { ToastBar } from '../workout/parts';

interface Props {
  db: WorkoutDb;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Food tab: today's calories and macros, fibre row, the four meals, and the add-food sheet. */
export function FoodScreen({ db, now = () => new Date() }: Props) {
  const c = useTheme();
  const { profile, status } = useProfile();
  const { ready: settingsReady, settings, loadFailed, setFlex } = useSettings();
  const [flexOpen, setFlexOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState<Meal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const f = useFoodDay({ db, now, notify });

  if (status !== 'ready' || !settingsReady || !f.ready) return <Page><Hint>Loading…</Hint></Page>;

  // TODO(#159 follow-up): the lab hold is not stored yet, so it is off for the target and for planning a flex.
  const target = kcalTarget(f.date, { flex: settings.flex }, profile);
  const facts: FoodFacts[] = [...catalogFoods, ...f.mineFacts];
  const t = logTotals(f.logs, facts);
  const left = target - t.kcal;
  const complete = f.note?.complete === true;
  const todaysFlex = settings.flex.filter((x) => x.date === f.date);
  const flexDelta = todaysFlex.reduce((a, x) => a + x.kcal_delta, 0);
  const blocked = (): boolean => {
    if (loadFailed) notify('Couldn’t read your saved settings, so changes are not saved. Restart the app to try again.');
    return loadFailed;
  };
  const plan = (extra: number) => {
    if (blocked()) return;
    const r = planFlex({ extra, date: f.date, today: f.date, id: newId(), flex: settings.flex }, profile);
    setFlex(r.flex);
    setFlexOpen(false);
    notify(flexToast(extra, r));
  };
  const undo = (id: string) => {
    if (!blocked()) setFlex(undoFlex(settings.flex, id));
  };

  return (
    <View style={styles.fill}>
      <Page>
        <H1>Food</H1>
        <View accessibilityRole="summary" accessibilityLabel={`${fmt(t.kcal)} of ${fmt(target)} kcal eaten`} style={styles.gap}>
          <Text style={{ color: left < 0 ? c.danger : c.ink, fontSize: 40, fontWeight: '800' }}>{fmt(Math.abs(left))}</Text>
          <Text style={{ color: c.muted }}>{left < 0 ? 'kcal over' : 'kcal left'}</Text>
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
            <Note>{flexDelta > 0 ? `Today’s target includes +${flexDelta} kcal for a bigger meal, balanced over the next few days.` : `Today’s target is ${-flexDelta} kcal lower to balance an earlier bigger day.`}</Note>
            {/* TODO(#178): this undoes the first of today's plans, not the newest; fix with the spec change in the prototype and core. */}
            <Button label="Undo" a11yLabel="Undo bigger day" kind="link" onPress={() => undo(todaysFlex[0]!.id)} />
          </View>
        ) : null}
        <View style={styles.gap}>
          {/* TODO: move these chips into the "What should I eat next?" card (as in the prototype) once that card exists. */}
          <Button label="Plan a bigger day" kind="ghost" expanded={flexOpen} onPress={() => setFlexOpen(!flexOpen)} />
          {flexOpen ? (
            <>
              <View style={styles.wrap}>
                {[300, 500, 800].map((x) => <Button key={x} label={`+${x} kcal today`} kind="ghost" onPress={() => plan(x)} />)}
              </View>
              <Hint>For a wedding, party or big meal out. The extra is taken off the next few days, never below your minimum.</Hint>
            </>
          ) : null}
        </View>
        {MEALS.map((m) => (
          <MealSection key={m} meal={m} items={f.logs.filter((l) => l.meal === m)} facts={facts} onRemove={f.remove} onAdd={() => setAdding(m)} />
        ))}
        {f.logs.length ? (
          <Pressable accessibilityRole="checkbox" accessibilityLabel="I’ve logged everything I ate today" accessibilityState={{ checked: complete }} aria-checked={complete} onPress={() => f.setComplete(!complete)} style={styles.check}>
            <View style={[styles.box, { borderColor: c.brand, backgroundColor: complete ? c.brand : 'transparent' }]}>{complete ? <Text style={{ color: c.onBrand, fontWeight: '800' }}>✓</Text> : null}</View>
            <Text style={{ color: c.ink, flex: 1 }}>I’ve logged everything I ate today <Text style={{ color: c.muted }}>(only complete days are used for your real calorie burn)</Text></Text>
          </Pressable>
        ) : null}
      </Page>
      {adding ? <AddSheet meal={adding} mine={f.mine} mineFacts={f.mineFacts} onAdd={(n) => f.add(adding, n)} onSaveMine={f.saveMine} onClose={() => setAdding(null)} /> : null}
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
      <View style={[styles.track, { backgroundColor: c.track }]}><View style={{ height: 8, borderRadius: 4, backgroundColor: color, width: `${goal > 0 ? Math.min(100, (v / goal) * 100) : 0}%` }} /></View>
    </View>
  );
}

function MealSection({ meal, items, facts, onRemove, onAdd }: { meal: Meal; items: FoodLog[]; facts: FoodFacts[]; onRemove: (id: string) => void; onAdd: () => void }) {
  const c = useTheme();
  const kcal = logTotals(items, facts).kcal;
  return (
    <View style={styles.gap}>
      <View style={styles.between}>
        <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '800', fontSize: 18 }}>{meal}</Text>
        <Text style={{ color: c.muted }}>{items.length ? `${fmt(kcal)} kcal` : ''}</Text>
      </View>
      {items.map((m) => (
        <View key={m.id} style={[styles.item, { borderColor: c.line, backgroundColor: c.surface }]}>
          <View style={styles.fill}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{m.name}{m.qty !== 1 ? ` ×${r1(m.qty)}` : ''}</Text>
            <Text style={{ color: c.muted, fontSize: 14 }}>{`${fmt(m.protein_g * m.qty)} g protein, ${fmt(m.carbs_g * m.qty)} g carbs, ${fmt(m.fat_g * m.qty)} g fat`}</Text>
          </View>
          <Text style={{ color: c.ink, fontWeight: '700' }}>{fmt(m.kcal * m.qty)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${m.name}`} onPress={() => onRemove(m.id)} style={styles.x}><Text style={{ color: c.muted, fontSize: 22 }}>×</Text></Pressable>
        </View>
      ))}
      <Button label={`+ Add to ${meal.toLowerCase()}`} onPress={onAdd} kind="ghost" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: 4, marginTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  b: { fontWeight: '700' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginTop: 12 },
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
