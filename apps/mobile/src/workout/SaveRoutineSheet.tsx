import { useId, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ROUTINE_EXERCISES_MAX, ROUTINE_MAX_LIVE, ROUTINE_NAME_MAX } from '@plate-and-bar/core';
import { SheetModal } from '../components/Sheet';
import { Button, COLUMN_MAX, ErrorText, Field, Heading, Hint, Note } from '../components/ui';
import { RoutineError, createRoutine, type RoutineExercise } from '../db/routines';
import type { WorkoutDb } from '../db/workouts';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { ROUTINE_COPY as T } from './copy';

/** "Save as routine" (#1184): names today's exercises (already `routineFromSession`) and stores them on the device; sync pushes it later. */
export function SaveRoutineSheet({ db, exercises, defaultName, capped, onSaved, onClose }: { db: WorkoutDb; exercises: RoutineExercise[]; defaultName: string; /** The session had more exercises than a routine keeps: says so. */ capped?: boolean; onSaved: (name: string) => void; onClose: () => void }) {
  const c = useTheme();
  const errId = `${useId().replace(/:/g, '')}-routine-error`;
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not `busy`: two presses before the next render both see the old state.
  const inFlight = useRef(false);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await createRoutine(db, name, exercises);
      onSaved(r.name);
    } catch (e) {
      setError(e instanceof RoutineError ? (e.code === 'too_many' ? T.tooMany(ROUTINE_MAX_LIVE) : e.code === 'name' ? T.nameError(ROUTINE_NAME_MAX) : T.failed) : T.failed);
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <SheetModal title={T.title} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Heading level={2} style={[type.heading, { color: c.ink }]}>
            {T.title}
          </Heading>
          <Hint>{T.hint}</Hint>
          {capped ? <View accessibilityLiveRegion="polite"><Note>{T.capped(ROUTINE_EXERCISES_MAX)}</Note></View> : null}
          <Field label={T.nameLabel} value={name} onChangeText={(v) => (setName(v), setError(null))} invalid={!!error} accessibilityHint={error ?? undefined} describedBy={error ? errId : undefined} onSubmitEditing={() => void save()} returnKeyType="done" />
          {error ? <ErrorText id={errId}>{error}</ErrorText> : null}
          <Button label={T.save} onPress={() => void save()} busy={busy} />
          <Button label={T.cancel} kind="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 16, alignItems: 'center' },
  body: { width: '100%', maxWidth: COLUMN_MAX, gap: 12 },
});
