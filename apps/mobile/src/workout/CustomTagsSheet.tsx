import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import type { ExerciseTag } from '@plate-and-bar/core';
import { Button, Heading, Hint, Label } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { MUSCLE_CODES, muscleName } from './copy';
import { Chip } from './parts';

/**
 * Tags for an exercise the user typed (prototype `tagSheet`): the muscles it trains, so it gets coverage, swaps and weight
 * guidance. Without an AI suggestion the other tags take the prototype's fallback (pattern `h-press`, family `custom`,
 * equipment `machine`, difficulty 2, no joints).
 */
export function CustomTagsSheet({ name, onSave, onClose, notify }: { name: string; onSave: (tags: ExerciseTag) => void; onClose: () => void; notify: (msg: string) => void }) {
  const c = useTheme();
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<string[]>([]);
  const toggle = (list: string[], set: (l: string[]) => void, m: string) => set(list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  const save = () => {
    if (!primary.length) return notify('Pick at least one main muscle.');
    onSave({ pattern: 'h-press', family: 'custom', equipment: 'machine', difficulty: 2, primary, secondary, joints: [] });
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
          {name}
        </Heading>
        <Hint>Tap the muscles this exercise trains. Tags let it count toward coverage and get swaps.</Hint>
        <Label>Main muscles</Label>
        <View style={styles.chips}>
          {MUSCLE_CODES.map((m) => (
            <Chip key={m} label={`Main muscle: ${muscleName(m)}`} text={muscleName(m)} pressed={primary.includes(m)} onPress={() => toggle(primary, setPrimary, m)} />
          ))}
        </View>
        <Label>Also working</Label>
        <View style={styles.chips}>
          {MUSCLE_CODES.map((m) => (
            <Chip key={m} label={`Also working: ${muscleName(m)}`} text={muscleName(m)} pressed={secondary.includes(m)} onPress={() => toggle(secondary, setSecondary, m)} />
          ))}
        </View>
        <Button label="Add exercise" a11yLabel={`Add ${name} with these muscles`} onPress={save} />
        <Button label="Cancel" kind="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
