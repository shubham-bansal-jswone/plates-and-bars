import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { glowShadow } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export const TICK_SIZE = 56;
export const SET_ROW_H = 64;
export const RING_SIZE = 100;
export const RING_STROKE = 7;

/** A progress ring: `track` under, `brand` over, `children` centred. `progress` is 0 to 1. Decorative: the label gives the percentage. */
export function Ring({ progress, label, size = RING_SIZE, stroke = RING_STROKE, children }: { progress: number; label: string; size?: number; stroke?: number; children?: ReactNode }) {
  const c = useTheme();
  const p = Math.min(1, Math.max(0, progress));
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, shadowColor: c.glow, ...glowShadow }]}>
      <View accessibilityLabel={label} style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.track} strokeWidth={stroke} fill="none" />
          <Circle
            testID="ring-progress"
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={c.brand}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${len * p} ${len}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
      </View>
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' } });
