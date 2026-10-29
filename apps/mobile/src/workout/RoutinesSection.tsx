import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ROUTINE_MAX_LIVE, ROUTINE_NAME_MAX } from '@plate-and-bar/core';
import { SheetModal } from '../components/Sheet';
import { Text } from '../components/Text';
import { Button, COLUMN_MAX, ErrorText, Field, Heading, Hint } from '../components/ui';
import { RoutineError, deleteRoutine, loadRoutines, renameRoutine, undoDeleteRoutine, type Routine } from '../db/routines';
import type { WorkoutDb } from '../db/workouts';
import { useDataVersion } from '../sync/useDataVersion';
import { type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { MY_ROUTINES as T, ROUTINE_COPY } from './copy';

/** Rename or delete one routine (#1184). Rename checks the name as Save as routine does, and announces the error. */
function RoutineSheet({ db, routine, onClose, onRenamed, onDeleted }: { db: WorkoutDb; routine: Routine; onClose: () => void; onRenamed: (name: string) => void; onDeleted: () => void }) {
  const c = useTheme();
  const errId = `${useId().replace(/:/g, '')}-rename-error`;
  const [name, setName] = useState(routine.name);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const run = async (task: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await task();
    } catch (e) {
      setError(e instanceof RoutineError ? (e.code === 'name' ? ROUTINE_COPY.nameError(ROUTINE_NAME_MAX) : e.code === 'missing' ? T.missing : T.failed) : T.failed);
      busy.current = false;
    }
  };
  return (
    <SheetModal title={routine.name} onClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Heading level={2} style={[type.heading, { color: c.ink }]}>
            {routine.name}
          </Heading>
          <Field label={T.renameLabel} value={name} onChangeText={(v) => (setName(v), setError(null))} invalid={!!error} accessibilityHint={error ?? undefined} describedBy={error ? errId : undefined} onSubmitEditing={() => void run(async () => (await renameRoutine(db, routine.id as string, name), onRenamed(name.trim())))} returnKeyType="done" />
          {error ? <ErrorText id={errId}>{error}</ErrorText> : null}
          <Button label={T.rename} onPress={() => void run(async () => (await renameRoutine(db, routine.id as string, name), onRenamed(name.trim())))} />
          <Button label={T.delete} kind="ghost" onPress={() => void run(async () => (await deleteRoutine(db, routine.id as string), onDeleted()))} />
          <Button label={T.close} kind="link" onPress={onClose} />
        </View>
      </ScrollView>
    </SheetModal>
  );
}

/**
 * "My routines" (#1184): saved routines beside the generated plan on the Start screen. Hidden with none. Delete is a tombstone with an
 * inline Undo row (it stays until used or until another delete; a toast would vanish before a screen reader or a slow hand gets to it).
 */
export function RoutinesSection({ db, onStart, notify }: { db: WorkoutDb; onStart: (r: Routine) => void; notify: (msg: string) => void }) {
  const c = useTheme();
  const version = useDataVersion();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string; error?: boolean } | null>(null);
  const reload = useCallback(() => loadRoutines(db).then(setRoutines, () => undefined), [db]);
  useEffect(() => void reload(), [reload, version]);
  if (!routines.length && !undo) return null;
  return (
    <View style={styles.section}>
      <Heading level={2} style={[type.heading, { color: c.ink }]}>
        {T.title}
      </Heading>
      {routines.map((r) => (
        <View key={r.id as string} style={[styles.row, { borderColor: c.line }]}>
          <View style={styles.name}>
            <Text style={[type.bodyStrong, { color: c.ink }]}>{r.name}</Text>
            <Text style={[type.caption, { color: c.muted }]}>{T.count(r.exercises.length)}</Text>
          </View>
          <Button label={T.more} a11yLabel={T.moreLabel(r.name)} kind="ghost" onPress={() => setEditing(r)} />
          <Button label={T.start} a11yLabel={T.startLabel(r.name)} onPress={() => onStart(r)} />
        </View>
      ))}
      {undo ? (
        <View accessibilityLiveRegion="polite" style={styles.undo}>
          <Hint>{undo.error ? ROUTINE_COPY.tooMany(ROUTINE_MAX_LIVE) : T.deleted(undo.name)}</Hint>
          <Button
            label={T.undo}
            a11yLabel={T.undoLabel(undo.name)}
            kind="ghost"
            onPress={() =>
              void undoDeleteRoutine(db, undo.id).then(
                () => (setUndo(null), notify(T.restored(undo.name)), reload()),
                (e) => setUndo(e instanceof RoutineError && e.code === 'too_many' ? { ...undo, error: true } : (notify(T.failed), null)),
              )
            }
          />
        </View>
      ) : null}
      {editing ? (
        <RoutineSheet
          db={db}
          routine={editing}
          onClose={() => setEditing(null)}
          onRenamed={(n) => (setEditing(null), notify(T.renamed(n)), void reload())}
          onDeleted={() => (setUndo({ id: editing.id as string, name: editing.name }), setEditing(null), void reload())}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingVertical: 8, borderTopWidth: 1 },
  name: { flex: 1 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sheet: { padding: 16, alignItems: 'center' },
  body: { width: '100%', maxWidth: COLUMN_MAX, gap: 12 },
});
