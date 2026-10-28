import { type ComponentRef, type Ref } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '../components/Text';
import { radius, tabular, type, dark as c } from '../theme/tokens';
import { CARD_H, CARD_PAD, CARD_W, HEADER_H, MORE_H, ROW_H, STATS_H, type ShareCardModel } from './shareModel';

/**
 * The picture that is shared. Always the dark identity, whatever the app theme, so it looks the same in every chat. It sits
 * far off screen (a window width and more to the left, so a wide window cannot show a strip of it) and is hidden from screen
 * readers (the Share button speaks the same text). Every block has a fixed height from shareModel's budget, and long text
 * is cut with an ellipsis, so nothing is clipped or wraps.
 */
export function ShareCard({ model, cardRef }: { model: ShareCardModel; cardRef: Ref<ComponentRef<typeof View>> }) {
  const { width } = useWindowDimensions();
  return (
    <View ref={cardRef} collapsable={false} testID="share-card" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.card, { left: -(width + CARD_W) }]}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={[type.small, { color: c.brand }]}>PLATE AND BAR</Text>
        <Text numberOfLines={1} style={[type.heading, { color: c.ink }]}>{model.title}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: c.body }]}>{model.dateLabel}</Text>
      </View>
      <View style={styles.stats}>
        {model.cardStats.map((s) => (
          <View key={s.label} style={styles.stat}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[type.label, tabular, { color: c.ink }]}>{s.value}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[type.small, { color: c.muted }]}>{s.label}</Text>
          </View>
        ))}
      </View>
      {model.rows.map((r, i) => (
        <View key={`${i}-${r.name}`} style={styles.row}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={[type.bodyStrong, styles.name, { color: c.ink }]}>{r.name}</Text>
          {r.pr ? <Text style={[type.small, styles.pr]}>PR</Text> : null}
          <Text numberOfLines={1} style={[type.bodyStrong, tabular, styles.best, { color: c.ink }]}>{r.best}</Text>
        </View>
      ))}
      {model.more ? <Text numberOfLines={1} style={[type.caption, styles.more, { color: c.muted }]}>+{model.more} more</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen, not display none: the capture needs a laid-out view. `left` is set from the window width.
  card: { position: 'absolute', top: 0, width: CARD_W, height: CARD_H, padding: CARD_PAD, backgroundColor: c.bg, overflow: 'hidden' },
  header: { height: HEADER_H, overflow: 'hidden' },
  stats: { height: STATS_H, flexDirection: 'row', gap: 8, paddingBottom: 16 },
  stat: { flex: 1, minWidth: 0, backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: 6, justifyContent: 'center' },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: c.line },
  name: { flex: 1, minWidth: 0 },
  best: { flexShrink: 0 },
  more: { height: MORE_H },
  pr: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden', backgroundColor: c.brand, color: c.onBrand },
});
