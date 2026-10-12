import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Heading } from '../components/ui';
import { useTheme } from '../theme/useTheme';

export function Placeholder({ title }: { title: string }) {
  const c = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: c.bg }]}>
      <Heading level={1} style={[styles.t, { color: c.ink }]}>
        {title}
      </Heading>
      <Text style={{ color: c.muted }}>Coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  t: { fontSize: 20, fontWeight: '700' },
});
