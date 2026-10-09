import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { older } from '@plate-and-bar/core';
import { Button, Hint, Press } from '../components/ui';
import { Text } from '../components/Text';
import type { Profile } from '../setup/types';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { litres } from './water';

interface Props {
  ml: number;
  count: number;
  target: { ml: number; trained: boolean };
  sizes: { glass_ml: number; bottle_ml: number };
  profile: Profile | null;
  onAdd: (ml: number) => void;
  onUndo: () => void;
}

/** Hydration card on Food: today's water against core's target, glass and bottle buttons, undo, and the tips. */
export function WaterCard({ ml, count, target, sizes, profile, onAdd, onUndo }: Props) {
  const c = useTheme();
  const [tips, setTips] = useState(false);
  const pct = target.ml > 0 ? (ml / target.ml) * 100 : 0;
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '600', fontSize: 18 }}>Water today</Text>
      <Text accessibilityLabel={`${litres(ml)} of about ${litres(target.ml)} litres`} style={{ color: c.ink, fontWeight: '700' }}>{`${litres(ml)} of about ${litres(target.ml)} L`}</Text>
      <View style={styles.wrap}>
        <Button label="+ Glass" a11yLabel={`Add a glass, ${sizes.glass_ml} millilitres`} kind="ghost" onPress={() => onAdd(sizes.glass_ml)} />
        <Button label="+ Bottle" a11yLabel={`Add a bottle, ${sizes.bottle_ml} millilitres`} kind="ghost" onPress={() => onAdd(sizes.bottle_ml)} />
        {count ? (
          <Press accessibilityRole="button" accessibilityLabel="Undo last water" onPress={onUndo} style={styles.x}>
            <Text style={{ color: c.muted, fontSize: 22 }}>↶</Text>
          </Press>
        ) : null}
      </View>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={`${Math.round(pct)}% of today’s water`} style={[styles.track, { backgroundColor: c.track }]}>
        <View style={{ height: 8, borderRadius: radius.full, backgroundColor: c.brand, width: `${Math.min(100, pct)}%` }} />
      </View>
      <Button label="Hydration tips" kind="link" expanded={tips} onPress={() => setTips(!tips)} />
      {tips ? (
        <View style={styles.gap}>
          <Hint>{`Your target is a rough guide: about 33 ml per kg of bodyweight${target.trained ? ', plus 600 ml because it’s a training day' : ''}. Food covers some of your needs too.`}</Hint>
          <Hint>{`Chai, coffee, milk, buttermilk and nimbu pani all count.${older(profile) ? ' After 60, thirst signals get weaker, so drink regularly through the day rather than waiting to feel thirsty.' : ''}`}</Hint>
          <Hint>Easy check: pale yellow urine is fine; dark yellow means drink more. Thirst is a useful signal too.</Hint>
          <Hint>Workouts: sip during sessions. For sessions over 60–90 minutes, or in heat, an ORS or electrolyte drink helps.</Hint>
          <Hint>More isn’t always better: drinking very large amounts quickly can be dangerous. If you have a kidney or heart condition, follow your doctor’s fluid advice.</Hint>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, marginTop: 12 },
  gap: { gap: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  track: { height: 8, borderRadius: radius.full, overflow: 'hidden' },
  x: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
