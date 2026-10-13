import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Heading, Hint } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from './catalog';
import { Chip } from './parts';

/** "Add exercise" (prototype `openExerciseSheet`): the exercise library by group, without the exercises already in the session. */
export function AddExerciseSheet({ inSession, onPick, onClose }: { inSession: readonly string[]; onPick: (name: string) => void; onClose: () => void }) {
  const c = useTheme();
  const have = new Set(inSession);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.body}>
          <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
            Add exercise
          </Heading>
          <Hint>It goes at the end of today’s session.</Hint>
          {Object.entries(getCatalog().library).map(([group, names]) => {
            const left = names.filter((n) => !have.has(n));
            return left.length ? (
              <View key={group} style={styles.group}>
                <Heading level={3} style={{ color: c.muted, fontSize: 14, fontWeight: '700' }}>
                  {group}
                </Heading>
                <View style={styles.chips}>
                  {left.map((n) => (
                    <Chip key={n} label={`Add ${n}`} text={n} onPress={() => onPick(n)} />
                  ))}
                </View>
              </View>
            ) : null;
          })}
          <Button label="Close" kind="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16 },
  body: { gap: 12 },
  group: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
