import { useEffect } from 'react';
import type { StoreDb } from '../db/records';
import { useProfile } from '../state/ProfileProvider';
import { restoreSchedule } from './sync';

/**
 * Renders nothing. Sets the reminder alarms from the stored choices when the app starts and whenever the plan's training days
 * change (also through a pull from another device), without the Targets tab being opened. Mounted inside the stores, so a wiped
 * store remounts it and it then finds no choices and schedules nothing.
 */
export function ReminderRestore({ db }: { db: StoreDb }) {
  const { profile, status } = useProfile();
  const days = profile?.days ?? null;
  useEffect(() => {
    if (status !== 'ready') return; // the plan is not read yet: its days are not known
    void restoreSchedule(db, days === null ? null : { days });
  }, [db, days, status]);
  return null;
}
