import type { ReactNode } from 'react';
import type { WorkoutDb } from '../db/workouts';
import { ProfileProvider } from '../state/ProfileProvider';
import { SettingsProvider } from '../state/SettingsProvider';
import { useSync } from './SyncProvider';

/**
 * The profile and settings stores wired to sync. A wiped store (`epoch`) remounts them so they start empty; pulled records
 * (`dataVersion`) make them read SQLite again without a remount, so forms and navigation survive and a later save cannot
 * overwrite what another device sent.
 */
export function Stores({ db, children }: { db: WorkoutDb; children: ReactNode }) {
  const { epoch, dataVersion } = useSync();
  return (
    <ProfileProvider key={epoch} db={db} reloadKey={dataVersion}>
      <SettingsProvider db={db} reloadKey={dataVersion}>
        {children}
      </SettingsProvider>
    </ProfileProvider>
  );
}
