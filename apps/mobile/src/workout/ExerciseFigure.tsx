import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SvgXml } from 'react-native-svg';
import { Text } from '../components/Text';
import { Press } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from './catalog';
import { figureAlt, getFigure, licenceLabel, themedSvg } from './figures';

/**
 * The start and end drawings of an exercise (content/exercise-images.json), side by side, with a small credit link to About.
 * Renders nothing when the exercise has no figure (the bundle is empty until the drawings land). One image element for the
 * pair carries the alt text; the frames are hidden from screen readers.
 */
export function ExerciseFigure({ name }: { name: string }) {
  const c = useTheme();
  const router = useRouter();
  const entry = getFigure(name);
  const xml = useMemo(() => entry?.frames.map((f) => themedSvg(f.svg, c)) ?? [], [entry, c]);
  if (!entry) return null;
  const alt = figureAlt(name, entry, getCatalog().cards[name]?.setup[0]);
  return (
    <View style={{ gap: 4 }}>
      <View accessible accessibilityRole="image" accessibilityLabel={alt} style={styles.row}>
        {entry.frames.map((f, i) => (
          <View
            key={f.file}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.frame, { aspectRatio: f.w / f.h, backgroundColor: c.tint, borderColor: c.line }]}
          >
            <SvgXml xml={xml[i]!} width="100%" height="100%" />
          </View>
        ))}
      </View>
      {entry.note ? <Text style={[type.caption, { color: c.body }]}>{entry.note}</Text> : null}
      <Press
        accessibilityRole="link"
        accessibilityLabel={`Drawing credit: ${entry.author}, ${licenceLabel(entry.licence)}. Opens About and sources`}
        onPress={() => router.push('/about' as never)}
        style={styles.credit}
      >
        <Text style={[type.small, { color: c.link }]}>{`Drawing: ${entry.author} (${licenceLabel(entry.licence)})`}</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  frame: { flex: 1, borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  credit: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
