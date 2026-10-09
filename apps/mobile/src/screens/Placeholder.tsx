import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/useTheme';

export function Placeholder({ title }: { title: string }) {
  const c = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: c.bg }]}>
      <Text accessibilityRole="header" style={[styles.t, { color: c.ink }]}>
        {title}
      </Text>
      <Text style={{ color: c.muted }}>Coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  t: { fontSize: 20, fontWeight: '700' },
});
