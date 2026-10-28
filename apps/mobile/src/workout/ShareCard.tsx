import { type ComponentRef, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { radius, tabular, type, dark as c } from '../theme/tokens';
import type { ShareCardModel } from './shareModel';

/** Logical size of the card; it is captured at 3x (1080x1350). */
export const CARD_W = 360;
export const CARD_H = 450;

/**
 * The picture that is shared. Always the dark identity, whatever the app theme, so it looks the same in every chat. It sits
 * off screen and is hidden from screen readers (the Share button speaks the same text); it shows only the model's fields.
 */
export function ShareCard({ model, cardRef }: { model: ShareCardModel; cardRef: Ref<ComponentRef<typeof View>> }) {
  return (
    <View ref={cardRef} collapsable={false} testID="share-card" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.card}>
      <Text style={[type.small, { color: c.brand }]}>PLATE AND BAR</Text>
      <Text style={[type.title, { color: c.ink }]}>{model.title}</Text>
      <Text style={[type.caption, { color: c.body }]}>{model.dateLabel}</Text>
      <View style={styles.stats}>
        {model.stats.map((s) => (
          <View key={s.label} style={styles.stat}>
            <Text style={[type.metricSm, tabular, { color: c.ink }]}>{s.value}</Text>
            <Text style={[type.small, { color: c.muted }]}>{s.label}</Text>
          </View>
        ))}
      </View>
      {model.rows.map((r, i) => (
        <View key={`${i}-${r.name}`} style={styles.row}>
          <Text numberOfLines={1} style={[type.bodyStrong, { color: c.ink, flex: 1 }]}>{r.name}</Text>
          {r.pr ? <Text style={[type.small, styles.pr]}>PR</Text> : null}
          <Text style={[type.bodyStrong, tabular, { color: c.ink }]}>{r.best}</Text>
        </View>
      ))}
      {model.more ? <Text style={[type.caption, { color: c.muted }]}>+{model.more} more</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen, not display none: the capture needs a laid-out view.
  card: { position: 'absolute', left: -CARD_W - 100, top: 0, width: CARD_W, height: CARD_H, padding: 24, gap: 6, backgroundColor: c.bg, overflow: 'hidden' },
  stats: { flexDirection: 'row', gap: 12, paddingVertical: 14 },
  stat: { flex: 1, backgroundColor: c.surface, borderRadius: radius.md, padding: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: c.line, minHeight: 36 },
  pr: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden', backgroundColor: c.brand, color: c.onBrand },
});
