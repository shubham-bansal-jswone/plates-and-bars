import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Button } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { catalog } from '../workout/catalog';
import { Chip } from '../workout/parts';

/** "Exercise to avoid" (prototype `openAvoidPicker`): the exercise library by group; picking one opens the can't-do sheet. */
export function AvoidPicker({ visible, onPick, onClose }: { visible: boolean; onPick: (name: string) => void; onClose: () => void }) {
  const c = useTheme();
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
            Exercise to avoid
          </Text>
          {Object.entries(catalog.library).map(([group, names]) => (
            <View key={group} style={styles.group}>
              <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 14, fontWeight: '700' }}>
                {group}
              </Text>
              <View style={styles.chips}>
                {names.map((n) => (
                  <Chip key={n} label={n} onPress={() => onPick(n)} />
                ))}
              </View>
            </View>
          ))}
          <Button label="Close" kind="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center', flexGrow: 1 },
  body: { width: '100%', maxWidth: 560, gap: 12 },
  group: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
