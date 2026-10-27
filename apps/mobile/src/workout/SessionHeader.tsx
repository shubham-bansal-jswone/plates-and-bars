import { StyleSheet, View } from 'react-native';
import { Heading, Press } from '../components/ui';
import { Text } from '../components/Text';
import { glowShadow, radius, tabular, type } from '../theme/tokens';
import { ExerciseFigure, hasFigure } from './ExerciseFigure';
import { useTheme } from '../theme/useTheme';
import type { ExState } from './model';

/** One 6px segment per exercise: `track` pending, `brand` when all its sets are ticked, partly filled between. */
export function SegmentBar({ exs }: { exs: readonly ExState[] }) {
  const c = useTheme();
  return (
    <View aria-hidden style={styles.bar}>
      {exs.map((e) => {
        const f = e.sets.length ? e.sets.filter((s) => s.done).length / e.sets.length : 0;
        return (
          <View key={e.name} style={[styles.seg, { backgroundColor: c.track }]}>
            <View style={{ width: `${f * 100}%`, height: 6, backgroundColor: c.brand }} />
          </View>
        );
      })}
    </View>
  );
}

/** The workout name on the start view: `display`, shrunk to `title` past 24 characters, up to two lines. */
export function Hero({ title }: { title: string }) {
  const c = useTheme();
  return (
    <Heading level={1} style={[title.length > 24 ? type.title : type.display, { color: c.ink, marginTop: 8 }]}>
      {title}
    </Heading>
  );
}

/** The one lime action of the start view: full width, 56 high, with the glow. */
export function StartButton({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.start, { backgroundColor: pressed ? c.brandPressed : c.brand, borderColor: c.brand, shadowColor: c.glow, ...glowShadow }]}
    >
      <Text style={[type.button, { color: c.onBrand }]}>{label}</Text>
    </Press>
  );
}

/** The row thumbnail: the exercise's own drawing (56px, start frame) when it has one, else the index number in a 40px square. */
export function IndexThumb({ n, name }: { n: number; name?: string }) {
  const c = useTheme();
  if (name && hasFigure(name)) return <ExerciseFigure name={name} size="thumb" />;
  return (
    <View aria-hidden style={[styles.thumb, { backgroundColor: c.surfaceSoft }]}>
      <Text style={[type.bodyStrong, tabular, { color: c.muted }]}>{n}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 6, borderRadius: radius.full, overflow: 'hidden' },
  start: { minHeight: 56, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 8 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
