import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SvgXml } from 'react-native-svg';
import { Text } from '../components/Text';
import { Press } from '../components/ui';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { exerciseMotionEnabled } from '../motion/flag';
import { getMotion } from '../motion/data';
import { MotionFigure } from '../motion/MotionFigure';
import { getCatalog } from './catalog';
import { figureAlt, getFigure, licenceLabel, themedSvg } from './figures';

/**
 * The start and end drawings of an exercise (content/exercise-images.json), side by side, with a small credit link to About.
 * A single frame is drawn at the size of one frame of a pair, centred. Renders nothing when the exercise has no figure (the bundle is empty until the drawings land). One image element for the
 * pair carries the alt text; the frames are hidden from screen readers.
 * `size="thumb"` is the start frame alone at 56 dp for list rows: decorative (the row names the exercise), no credit or note, and the credit stays on the full figure.
 */
export function ExerciseFigure({ name, size = 'full' }: { name: string; size?: 'full' | 'thumb' }) {
  return size === 'thumb' ? <FigureThumb name={name} /> : <FigurePair name={name} />;
}

/** True when the exercise has a drawing; list rows use it to pick the thumbnail or a placeholder. */
export const hasFigure = (name: string): boolean => getFigure(name) !== undefined;

function FigureThumb({ name }: { name: string }) {
  const c = useTheme();
  const entry = getFigure(name);
  const xml = useMemo(() => (entry ? themedSvg(entry.frames[0]!.svg, c) : ''), [entry, c]);
  if (!entry) return null;
  return (
    <View testID="figure-thumb" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.thumb, { backgroundColor: c.surface, borderColor: c.line }]}>
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

function FigurePair({ name }: { name: string }) {
  const c = useTheme();
  const router = useRouter();
  const entry = getFigure(name);
  const xml = useMemo(() => entry?.frames.map((f) => themedSvg(f.svg, c)) ?? [], [entry, c]);
  // Behind EXPO_PUBLIC_EXERCISE_MOTION (#1069): a motion entry replaces the pair; no entry, or the flag off, keeps the v1.1 frames.
  const motion = exerciseMotionEnabled() ? getMotion(name) : undefined;
  if (motion) return <MotionFigure name={name} entry={motion} />;
  if (!entry) return null;
  const alt = figureAlt(name, entry, getCatalog().cards[name]?.setup[0]);
  // The visible text starts the accessible name, so axe's label-content-name-mismatch rule holds.
  const credit = `Drawing: ${entry.author} (${licenceLabel(entry.licence)})`;
  return (
    <View style={{ gap: 4 }}>
      <View accessible accessibilityRole="image" accessibilityLabel={alt} testID="figure-row" style={[styles.row, entry.frames.length === 1 && styles.rowLone]}>
        {entry.frames.map((f, i) => (
          <View
            key={f.file}
            testID="figure-frame"
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.frame, entry.frames.length === 1 && styles.frameLone, { aspectRatio: f.w / f.h, backgroundColor: c.tint, borderColor: c.line }]}
          >
            <SvgXml xml={xml[i]!} width="100%" height="100%" />
          </View>
        ))}
      </View>
      {entry.note ? <Text style={[type.caption, { color: c.body }]}>{entry.note}</Text> : null}
      <Press
        accessibilityRole="link"
        accessibilityLabel={`${credit}. Opens About and sources`}
        onPress={() => router.push('/about' as never)}
        style={styles.credit}
      >
        <Text style={[type.small, { color: c.link }]}>{credit}</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  // A lone frame (an isometric hold) is the width of one frame of a pair, centred: half the row less half the gap, so the 50% side padding and 2 dp margins leave (W - 8) / 2.
  rowLone: { paddingHorizontal: '25%' },
  frameLone: { marginHorizontal: 2 },
  frame: { flex: 1, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  thumb: { width: 56, height: 56, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  credit: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
