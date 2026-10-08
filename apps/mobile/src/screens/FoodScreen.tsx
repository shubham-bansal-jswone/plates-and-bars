import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fibreTarget, FRUIT_VEG_TARGET, fruitVegServings, kcalTarget, logTotals, showAddedSugar, type FoodFacts } from '@plate-and-bar/core';
import { fmt } from '../format';
import { Button, H1, Hint, Page } from '../components/ui';
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
  const { ready: settingsReady, settings } = useSettings();
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

  // TODO(#159): flex chips (+300/+500/+800) once core has the flex rules; the target already includes today's flex entries.
  // Lab hold is not stored yet, so it is off here.
  const target = kcalTarget(f.date, { flex: settings.flex }, profile);
  const facts: FoodFacts[] = [...catalogFoods, ...f.mineFacts];
  const t = logTotals(f.logs, facts);
  const left = target - t.kcal;
  const complete = f.note?.complete === true;

  return (
    <View style={styles.fill}>
      <Page>
        <H1>Food</H1>
        <View accessibilityRole="summary" accessibilityLabel={`${fmt(t.kcal)} of ${fmt(target)} kcal eaten`} style={styles.gap}>
          <Text style={{ color: left < 0 ? c.danger : c.ink, fontSize: 40, fontWeight: '800' }}>{fmt(Math.abs(left))}</Text>
          <Text style={{ color: c.muted }}>{left < 0 ? 'kcal over' : 'kcal left'}</Text>
          <Text style={{ color: c.ink }}>{`${fmt(t.kcal)} of ${fmt(target)} kcal eaten`}</Text>
        </View>
        {profile ? (
          <>
            <Macro name="Protein" v={t.protein_g} goal={profile.targets.protein_g} color={c.protein} />
            <Macro name="Carbs" v={t.carbs_g} goal={profile.targets.carbs_g} color={c.carbs} />
            <Macro name="Fat" v={t.fat_g} goal={profile.targets.fat_g} color={c.fat} />
          </>
        ) : (
          <Hint>Finish setup to see your protein, carbs and fat targets.</Hint>
        )}
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
        {MEALS.map((m) => (
          <MealSection key={m} meal={m} items={f.logs.filter((l) => l.meal === m)} onRemove={f.remove} onAdd={() => setAdding(m)} />
        ))}
        {f.logs.length ? (
          <Pressable accessibilityRole="checkbox" accessibilityLabel="I’ve logged everything I ate today" accessibilityState={{ checked: complete }} onPress={() => f.setComplete(!complete)} style={styles.check}>
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

function MealSection({ meal, items, onRemove, onAdd }: { meal: Meal; items: FoodLog[]; onRemove: (id: string) => void; onAdd: () => void }) {
  const c = useTheme();
  const kcal = items.reduce((a, m) => a + m.kcal * m.qty, 0);
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
