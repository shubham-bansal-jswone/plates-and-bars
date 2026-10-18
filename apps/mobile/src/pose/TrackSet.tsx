import { useEffect, useState, type ComponentType } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/Sheet';
import { Text } from '../components/Text';
import { Button, Heading, Hint } from '../components/ui';
import { useTheme } from '../theme/useTheme';
import { poseAvailable, poseExercise } from './flag';
import { loadPoseSession } from './load';
import type { PoseSessionProps } from './pose-session';

// Kept here, not in copy.ts: this file is in the main bundle and copy.ts is loaded with the camera view.
const t = { open: 'Track this set', title: 'Track this set', loading: 'Loading', failed: 'Tracking could not load. Check your connection and try again.', close: 'Close' } as const;

type Session = ComponentType<PoseSessionProps>;

/**
 * "Track this set" on a Bodyweight or Goblet Squat card (#947): opens the camera sheet. Nothing shows unless the flag is on, the
 * device has a camera, the exercise is one of the two and a set is not ticked yet. The camera view and the model load only when the sheet opens
 * (`import()`), so the main bundle does not carry them. Applying a count only fills the set's reps field; the user still ticks the set.
 */
export function TrackSet({ name, sets, onApply, available = poseAvailable() }: { name: string; sets: readonly { done: boolean }[]; onApply: (set: number, count: number) => void; available?: boolean }) {
  const [open, setOpen] = useState(false);
  const exercise = poseExercise(name);
  // With every set ticked there is no set left to fill, and "Use N reps" would overwrite a finished set's reps.
  const set = sets.findIndex((s) => !s.done);
  if (!available || !exercise || set < 0) return null;
  return (
    <>
      <Button label={t.open} a11yLabel={`${t.open} of ${name}`} kind="link" expanded={open} onPress={() => setOpen(true)} />
      {open ? (
        <SheetModal title={t.title} onClose={() => setOpen(false)}>
          <TrackSheet
            exercise={exercise}
            setNumber={set + 1}
            onApply={(n) => {
              onApply(set, n);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </SheetModal>
      ) : null}
    </>
  );
}

function TrackSheet(props: Omit<PoseSessionProps, 'getStream' | 'load' | 'now'>) {
  const c = useTheme();
  const [Session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadPoseSession().then(
      (m) => live && setSession(() => m.PoseSession),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet}>
      <View style={styles.body}>
        <Heading level={2} style={{ color: c.ink, fontWeight: '300', fontSize: 22 }}>
          {t.title}
        </Heading>
        {Session ? <Session {...props} /> : failed ? <Hint>{t.failed}</Hint> : <Text style={{ color: c.muted }}>{t.loading}</Text>}
        {Session ? null : <Button label={t.close} kind="ghost" onPress={props.onClose} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ sheet: { padding: 16 }, body: { gap: 12 } });
