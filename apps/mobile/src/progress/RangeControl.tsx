import { StyleSheet, View } from 'react-native';
import type { SeriesRange } from '@plate-and-bar/core';
import { Text } from '../components/Text';
import { Press, a11yState } from '../components/ui';
import { CHART_MAX_WIDTH, radius, space, type as typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { RANGE_GROUP, RANGE_LABEL, RANGE_NO_DATA } from './copy';

export const RANGES: readonly SeriesRange[] = ['4w', '12w', 'all'];

/**
 * A segmented control for a chart's range: three equal 44px segments, the chosen one filled and bold. A segment in `disabled` cannot
 * be chosen; its reason is spoken as its hint, and the caller shows `RANGE_NO_DATA` as text beside the control.
 */
export function RangeControl({ value, disabled, onChange, noun }: { value: SeriesRange; disabled: ReadonlySet<SeriesRange>; onChange: (r: SeriesRange) => void; noun: string }) {
  const c = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={RANGE_GROUP(noun)} style={styles.row}>
      {RANGES.map((r) => {
        const selected = r === value;
        const off = disabled.has(r);
        return (
          <Press
            key={r}
            accessibilityRole="tab"
            accessibilityLabel={RANGE_LABEL[r]}
            accessibilityHint={off ? RANGE_NO_DATA(r) : undefined}
            disabled={off}
            {...a11yState({ selected, disabled: off || undefined })}
            onPress={() => onChange(r)}
            style={[styles.seg, { backgroundColor: selected ? c.brand : c.surfaceSoft }, off && styles.off]}
          >
            <Text style={[typeScale.buttonSm, { color: selected ? c.onBrand : c.ink, fontWeight: selected ? '800' : '500' }]}>{RANGE_LABEL[r]}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.xs, width: '100%', maxWidth: CHART_MAX_WIDTH },
  seg: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  off: { opacity: 0.55 },
});
