import { StyleSheet, View } from 'react-native';
import { clearanceNote } from '../setup/results';
import type { Profile } from '../setup/types';
import { radius, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Text } from './Text';
import { Button, Heading } from './ui';

/**
 * "Check with your doctor first" (prototype `clearanceNoteHtml`): shown while core's `needsClearance` holds.
 * `onCleared` adds the "My doctor has cleared me" button.
 */
export function ClearanceCard({ profile, onCleared }: { profile: Profile; onCleared?: () => void }) {
  const c = useTheme();
  const clear = clearanceNote(profile);
  if (!clear) return null;
  return (
    <View style={[styles.card, { borderColor: c.danger, backgroundColor: c.surface }]}>
      <Heading level={2} style={[type.label, { color: c.ink }]}>
        {clear.title}
      </Heading>
      <Text style={{ color: c.ink, lineHeight: 20 }}>{clear.body}</Text>
      {onCleared ? <Button label="My doctor has cleared me" onPress={onCleared} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ card: { borderWidth: 2, borderRadius: radius.lg, padding: 16, gap: 6 } });
