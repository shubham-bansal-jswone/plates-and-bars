import { StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';

/**
 * Loading placeholder: plain surface blocks (no animation). Screen readers get the one line "Loading…"
 * (visually hidden); the blocks themselves are hidden from them. `heights` is one block each.
 */
export function Skeleton({ heights = [96, 64, 64] }: { heights?: number[] }) {
  const c = useTheme();
  return (
    <View testID="skeleton" style={{ gap: space.md, marginTop: space.md }}>
      <Text role="status" accessibilityLiveRegion="polite" style={styles.srOnly}>Loading…</Text>
      <View aria-hidden style={{ gap: space.md }}>
        {heights.map((h, i) => (
          <View key={i} style={{ height: h, borderRadius: radius.lg, backgroundColor: c.surface }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  srOnly: { position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', opacity: 0 },
});
