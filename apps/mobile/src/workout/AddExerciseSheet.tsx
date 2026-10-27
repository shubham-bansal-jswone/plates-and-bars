import { useState } from 'react';
import { SheetModal } from '../components/Sheet';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Field, Heading, Hint } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { getCatalog } from './catalog';
import { LibraryEntryButton } from '../library/LibraryEntryButton';
import { Chip } from './parts';
import type { WorkoutList } from './workoutLists';

/** "Add exercise" (prototype `openExerciseSheet`): the exercise library by group, without the exercises already in the session. */
export function AddExerciseSheet({ inSession, workouts = [], onPick, onCustom, onClose }: { inSession: readonly string[]; /** Workouts whose exercises are offered first, so a session can mix exercises from any of them. */ workouts?: readonly WorkoutList[]; onPick: (name: string) => void; /** A typed name (prototype `exCustom`). */ onCustom: (name: string) => void; onClose: () => void }) {
  const c = useTheme();
  const [typed, setTyped] = useState('');
  const have = new Set(inSession);
  return (
    <SheetModal title="Add exercise" onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
        <View style={styles.body}>
          <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
            Add exercise
          </Heading>
          <Hint>It goes at the end of today’s session.</Hint>
          <LibraryEntryButton onBeforeOpen={onClose} />
          <View style={styles.own}>
            <View style={{ flex: 1 }}>
              <Field label="Your own exercise" placeholder="Or type your own" value={typed} onChangeText={setTyped} />
            </View>
            <Button label="Add" a11yLabel="Add the exercise you typed" kind="ghost" onPress={() => onCustom(typed)} />
          </View>
          {workouts.map((wl) => {
            const left = wl.exercises.filter((n) => !have.has(n));
            return left.length ? (
              <View key={`w:${wl.name}`} style={styles.group}>
                <Heading level={3} style={{ color: c.muted, fontSize: 14, fontWeight: '700' }}>
                  From {wl.name}
                </Heading>
                <View style={styles.chips}>
                  {left.map((n) => (
                    <Chip key={n} label={`Add ${n} from ${wl.name}`} text={n} onPress={() => onPick(n)} />
                  ))}
                </View>
              </View>
            ) : null;
          })}
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
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16 },
  body: { gap: 12 },
  group: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  own: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
});
