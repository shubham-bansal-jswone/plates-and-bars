import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { num, waterSizeEntry } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Caption, Field, Hint, Label, Press } from '../components/ui';
import { loadUserFoods, saveUserFood } from '../db/food';
import { trackWrite } from '../db/pendingWrites';
import type { WorkoutDb } from '../db/workouts';
import type { UserFood } from '../food/types';
import type { Settings } from '../settings/types';
import { useDataVersion } from '../sync/useDataVersion';
import { useTheme } from '../theme/useTheme';

type SizeKey = keyof Settings['water_sizes'];

/** Prototype "Water sizes": glass and bottle ml, saved as typed once core's `waterSizeEntry` accepts the value. */
export function WaterSizesSection({ sizes, onChange }: { sizes: Settings['water_sizes']; onChange: (key: SizeKey, ml: number) => void }) {
  const [text, setText] = useState({ glass_ml: String(sizes.glass_ml), bottle_ml: String(sizes.bottle_ml) });
  // Tabs stay mounted, so a size pulled from the server shows here. A box whose text already reads as the stored size is left alone (no lost focus or half-typed text).
  // Adjusted while rendering, when the stored sizes change (React's pattern for state that follows a prop).
  const [seen, setSeen] = useState(sizes);
  if (seen.glass_ml !== sizes.glass_ml || seen.bottle_ml !== sizes.bottle_ml) {
    setSeen(sizes);
    const next = { ...text };
    for (const k of ['glass_ml', 'bottle_ml'] as const) if (Math.round(num(text[k])) !== sizes[k]) next[k] = String(sizes[k]);
    setText(next);
  }
  const edit = (k: SizeKey, v: string) => {
    setText((t) => ({ ...t, [k]: v }));
    const ml = waterSizeEntry(v);
    if (ml !== null) onChange(k, ml);
  };
  return (
    <View style={styles.gap}>
      <Label>Water sizes</Label>
      <View style={styles.row}>
        <View style={styles.half}>
          <Caption>Glass (ml)</Caption>
          <Field label="Glass (ml)" inputMode="numeric" value={text.glass_ml} onChangeText={(v) => edit('glass_ml', v)} />
        </View>
        <View style={styles.half}>
          <Caption>Bottle (ml)</Caption>
          <Field label="Bottle (ml)" inputMode="numeric" value={text.bottle_ml} onChangeText={(v) => edit('bottle_ml', v)} />
        </View>
      </View>
    </View>
  );
}

/** Prototype "My foods": the saved foods, each with a delete that writes a tombstone for sync. */
export function MyFoodsSection({ db, notify }: { db: WorkoutDb; notify: (msg: string) => void }) {
  const c = useTheme();
  const [foods, setFoods] = useState<UserFood[] | null>(null);
  const dataVersion = useDataVersion();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    // Waits for deletes still being written, so a pulled change never brings a deleted food back on screen.
    queue.current.then(() => loadUserFoods(db)).then((f) => live && setFoods(f), () => live && setFoods([]));
    return () => {
      live = false;
    };
  }, [db, dataVersion]);
  const remove = useCallback(
    (f: UserFood) => {
      setFoods((cur) => (cur ? cur.filter((x) => x.id !== f.id) : cur));
      const t = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      queue.current = queue.current.then(() => saveUserFood(db, { ...f, deleted_at: t, updated_at: t })).catch(() => {
        // The delete did not stick: show the food again so there is something to try again on.
        notify('Couldn’t save that. Try again.');
        return loadUserFoods(db).then((f) => void (mounted.current && setFoods(f)), () => {});
      });
      trackWrite(queue.current);
    },
    [db, notify],
  );
  return (
    <View style={styles.gap}>
      <Label>My foods</Label>
      {foods?.length ? (
        foods.map((f) => (
          <View key={f.id} style={styles.food}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 16 }}>{f.name}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{`${f.kcal} kcal, ${f.protein_g} g protein`}</Text>
            </View>
            <Press accessibilityRole="button" accessibilityLabel={`Delete ${f.name}`} onPress={() => remove(f)} style={styles.x}>
              <Text style={{ color: c.ink, fontSize: 22 }}>×</Text>
            </Press>
          </View>
        ))
      ) : (
        <Hint>Foods you add under Custom with “Save to my foods” show up here and at the top of the food list.</Hint>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  food: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  x: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
