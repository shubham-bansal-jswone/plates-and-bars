import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { OcrCrop } from '../../modules/plate-label-scanner/types';
import { Text } from '../components/Text';
import { Button, H1, Hint, Page, Press } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import type { LabelPhoto } from './capture';
import { LABEL_COPY as t } from './copy';
import { useFocusOnMount } from './focus';

/** How much one press trims, in percent of the photo; at least this much of each side stays inside the frame. */
const STEP = 5;
const MIN_KEPT = 20;
type Edges = { left: number; top: number; right: number; bottom: number };
const EDGES = ['left', 'top', 'right', 'bottom'] as const;

/** The frame as fractions of the photo, or undefined when nothing is trimmed (the whole photo is read). */
export function cropOf(e: Edges): OcrCrop | undefined {
  if (!e.left && !e.top && !e.right && !e.bottom) return undefined;
  return { x: e.left / 100, y: e.top / 100, width: (100 - e.left - e.right) / 100, height: (100 - e.top - e.bottom) / 100 };
}

/**
 * The crop step: the photo with a frame, and a pair of buttons per edge to move it in or out. Buttons rather than a drag, so the
 * frame can be set with a screen reader, a keyboard or a switch. The whole photo is read when nothing is trimmed.
 */
export function CropStep({ photo, onRead, onRetake, onClose }: { photo: LabelPhoto; onRead: (crop: OcrCrop | undefined) => void; onRetake: () => void; onClose: () => void }) {
  const c = useTheme();
  const focus = useFocusOnMount();
  const [e, setE] = useState<Edges>({ left: 0, top: 0, right: 0, bottom: 0 });
  const w = 100 - e.left - e.right;
  const h = 100 - e.top - e.bottom;
  const trim = (k: keyof Edges, d: number) =>
    setE((o) => {
      const n = { ...o, [k]: Math.max(0, o[k] + d) };
      return 100 - n.left - n.right < MIN_KEPT || 100 - n.top - n.bottom < MIN_KEPT ? o : n;
    });
  return (
    <Page>
      <View ref={focus} accessible><H1>{t.cropTitle}</H1></View>
      <Hint>{t.cropHint}</Hint>
      <View style={[styles.photo, { aspectRatio: photo.width / photo.height, backgroundColor: c.surfaceSoft }]}>
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={t.cropPhoto} />
        <View aria-hidden importantForAccessibility="no-hide-descendants" style={[styles.frame, { borderColor: c.brand, left: `${e.left}%`, top: `${e.top}%`, width: `${w}%`, height: `${h}%` }]} />
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>{t.frame(w, h)}</Text>
      {EDGES.map((k) => (
        <View key={k} style={styles.row}>
          <Text style={[styles.edge, { color: c.ink }]}>{`${k[0]!.toUpperCase()}${k.slice(1)}: ${e[k]}%`}</Text>
          <Press accessibilityRole="button" accessibilityLabel={t.trimMore(k)} onPress={() => trim(k, STEP)} style={[styles.step, { borderColor: c.line }]}><Text style={[styles.sign, { color: c.ink }]}>+</Text></Press>
          <Press accessibilityRole="button" accessibilityLabel={t.trimLess(k)} onPress={() => trim(k, -STEP)} disabled={e[k] === 0} style={[styles.step, { borderColor: c.line, opacity: e[k] === 0 ? 0.45 : 1 }]}><Text style={[styles.sign, { color: c.ink }]}>−</Text></Press>
        </View>
      ))}
      <Button label={t.read} onPress={() => onRead(cropOf(e))} />
      <Button kind="ghost" label={t.retake} onPress={onRetake} />
      <Button kind="ghost" label={t.close} onPress={onClose} />
    </Page>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', maxHeight: 480, borderRadius: 8, overflow: 'hidden' },
  frame: { position: 'absolute', borderWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  edge: { flexGrow: 1, fontSize: 16 },
  step: { borderWidth: 1, borderRadius: 999, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  sign: { fontSize: 22 },
});
