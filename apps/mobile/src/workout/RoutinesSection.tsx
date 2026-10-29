import { useCallback, useEffect, useId, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, Text as RNText, StyleSheet, View } from 'react-native';
import { ROUTINE_MAX_LIVE, ROUTINE_NAME_MAX } from '@plate-and-bar/core';
import { SheetModal } from '../components/Sheet';
import { Text } from '../components/Text';
import { focusNode } from '../labelscan/focus';
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

/** A delete waiting for Undo. Held by the Start screen, not by the section, which unmounts while a preview or pick list is open. */
export type PendingUndo = { id: string; name: string; error?: boolean };

/**
 * "My routines" (#1184): saved routines beside the generated plan on the Start screen. Hidden with none. Delete is a tombstone with an
 * inline Undo row (it stays until used, until another delete, or until the routine is back from another device; a toast would vanish before a screen reader or a slow hand gets to it).
 */
export function RoutinesSection({ db, onStart, notify, undo, setUndo }: { db: WorkoutDb; onStart: (r: Routine) => void; notify: (msg: string) => void; undo: PendingUndo | null; setUndo: (u: PendingUndo | null | ((p: PendingUndo | null) => PendingUndo | null)) => void }) {
  const c = useTheme();
  const version = useDataVersion();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [editing, setEditing] = useState<Routine | null>(null);
  // The latest load wins: a slower, older read must not bring back a row just deleted or drop the Undo for it.
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    return loadRoutines(db).then((list) => {
      if (mine !== seq.current) return;
      setRoutines(list);
      setUndo((u) => (u && list.some((r) => r.id === u.id) ? null : u)); // revived (here or on another device): nothing left to undo
    }, () => undefined);
  }, [db, setUndo]);
  useEffect(() => void reload(), [reload, version]);
  // Focus would drop to the page when the pressed Edit or Undo unmounts: move it to a row, or the heading. Runs after the sheet has handed focus back.
  const heading = useRef<ComponentRef<typeof RNText>>(null);
  const edits = useRef(new Map<string, ComponentRef<typeof View>>());
  const want = useRef<string | 'heading' | null>(null);
  useEffect(() => {
    const w = want.current;
    if (!w) return;
    const node = w === 'heading' ? heading.current : edits.current.get(w);
    if (!node) return; // the restored row is not loaded yet: try again when it is
    want.current = null;
    focusNode(node);
  }, [routines, undo, editing]);
  const reviving = useRef(false);
  if (!routines.length && !undo) return null;
  return (
    <View style={styles.section}>
      <Heading ref={heading} level={2} style={[type.heading, { color: c.ink }]}>
        {T.title}
      </Heading>
      {routines.map((r) => (
        <View key={r.id as string} style={[styles.row, { borderColor: c.line }]}>
          <View style={styles.name}>
            <Text style={[type.bodyStrong, { color: c.ink }]}>{r.name}</Text>
            <Text style={[type.caption, { color: c.muted }]}>{T.count(r.exercises.length)}</Text>
          </View>
          <Button ref={(n) => void (n ? edits.current.set(r.id as string, n) : edits.current.delete(r.id as string))} label={T.more} a11yLabel={T.moreLabel(r.name)} kind="ghost" onPress={() => setEditing(r)} />
          <Button label={T.start} a11yLabel={T.startLabel(r.name)} onPress={() => onStart(r)} />
        </View>
      ))}
      {undo ? (
        <View style={styles.undo}>
          <Hint>{undo.error ? ROUTINE_COPY.tooMany(ROUTINE_MAX_LIVE) : T.deleted(undo.name)}</Hint>
          <Button
            label={T.undo}
            a11yLabel={T.undoLabel(undo.name)}
            kind="ghost"
            onPress={() => {
              if (reviving.current) return;
              reviving.current = true;
              void undoDeleteRoutine(db, undo.id)
                .then(
                  () => {
                    want.current = undo.id;
                    setUndo(null);
                    notify(T.restored(undo.name));
                    void reload();
                  },
                  (e) => {
                    if (e instanceof RoutineError && e.code === 'too_many') {
                      setUndo({ ...undo, error: true });
                      notify(ROUTINE_COPY.tooMany(ROUTINE_MAX_LIVE));
                    } else {
                      notify(T.failed);
                      setUndo(null);
                    }
                  },
                )
                .finally(() => void (reviving.current = false));
            }}
          />
        </View>
      ) : null}
      {editing ? (
        <RoutineSheet
          db={db}
          routine={editing}
          onClose={() => setEditing(null)}
          onRenamed={(n) => (setEditing(null), notify(T.renamed(n)), void reload())}
          onDeleted={() => {
            const i = routines.findIndex((r) => r.id === editing.id);
            const next = routines[i + 1] ?? routines[i - 1];
            want.current = next ? (next.id as string) : 'heading';
            setUndo({ id: editing.id as string, name: editing.name });
            setEditing(null);
            notify(T.deletedAnnounce(editing.name));
            void reload();
          }}
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
