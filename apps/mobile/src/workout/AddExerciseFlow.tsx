import { useState } from 'react';
import { exerciseNameTooLong } from '@plate-and-bar/core';
import { useSettings } from '../state/SettingsProvider';
import { isBlank } from '../text/blank';
import { exerciseNamed } from './catalog';
import { AddExerciseSheet } from './AddExerciseSheet';
import { CustomTagsSheet } from './CustomTagsSheet';
import type { WorkoutList } from './workoutLists';

/**
 * The exercise picker with its custom-name path (prototype `exPick` / `exCustom`): a library pick or a typed name the library
 * knows (any case) is added; a new name first gets its muscles on the tag sheet. Used in a session and on the Start screen.
 * `add` returns false when the exercise is already in the session. `quiet` (the Start screen, as the prototype) skips the "added" toast:
 * the sheet closes and the session shows.
 */
export function AddExerciseFlow({ open, onClose, inSession, workouts, add, notify, quiet = false }: { open: boolean; onClose: () => void; inSession: readonly string[]; workouts?: readonly WorkoutList[]; add: (name: string) => boolean; notify: (msg: string) => void; quiet?: boolean }) {
  const [tagging, setTagging] = useState<string | null>(null);
  const { addCustomTags } = useSettings();
  const added = (name: string) => {
    if (!quiet) notify(`${name} added`);
  };
  const addTyped = (raw: string) => {
    const typed = raw.trim();
    if (isBlank(typed)) return notify('Type an exercise name.');
    if (exerciseNameTooLong(typed)) return notify('That exercise name is too long. Shorten it.');
    // A name the library knows (any case) is that exercise; a new one needs its muscles first (prototype exCustom).
    const known = exerciseNamed(typed);
    onClose();
    if (known) {
      if (add(known)) added(known);
      else notify(`${known} is already in today’s session.`);
    } else setTagging(typed);
  };
  return (
    <>
      {open ? (
        <AddExerciseSheet
          inSession={inSession}
          {...(workouts ? { workouts } : {})}
          onClose={onClose}
          onPick={(n) => {
            onClose();
            if (add(n)) added(n);
          }}
          onCustom={addTyped}
        />
      ) : null}
      {tagging ? (
        <CustomTagsSheet
          name={tagging}
          onClose={() => setTagging(null)}
          onSave={async (tags) => {
            const name = tagging;
            setTagging(null);
            // Only after the save has decided: a name it refuses (a near-duplicate a pull stored meanwhile) must not reach the workout.
            if (!(await addCustomTags(name, tags))) {
              // The refused name is the one the app has by now (what showed is what is stored): say which exercise it matches.
              const known = exerciseNamed(name);
              return notify(known && known !== name ? `That name matches ${known}. Use that name instead.` : 'Couldn’t save that exercise. Try again.');
            }
            if (add(name)) added(name);
            else notify(`${name} is already in today’s session.`);
          }}
        />
      ) : null}
    </>
  );
}
