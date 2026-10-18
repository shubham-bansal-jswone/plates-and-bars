import type { PlanProfile } from '@plate-and-bar/core';
import type { StoreDb } from '../db/records';
import { NOTIFICATIONS } from './copy';
import native, { type NativeRule } from './native';
import { buildSlots, type ReminderPrefs } from './schedule';
import { loadReminderPrefs } from './store';

/** The rules the Android module keeps for these choices. */
export function nativeRules(prefs: ReminderPrefs, profile: PlanProfile | null | undefined): NativeRule[] {
  return buildSlots(prefs, profile).map((s) => {
    const n = NOTIFICATIONS[s.kind];
    return { id: s.id, hour: Math.floor(s.minute / 60), minute: s.minute % 60, days: s.days, title: n.title, body: n.body, route: n.route };
  });
}

/** Hands the schedule to the platform. Replaces whatever was set; no choice on means none scheduled. A no-op where there is no module. */
export async function applySchedule(prefs: ReminderPrefs, profile: PlanProfile | null | undefined): Promise<void> {
  await native?.setRules(nativeRules(prefs, profile));
}

let chain: Promise<unknown> = Promise.resolve();
/** Runs reminder work one task at a time, app-wide, so a restore never lands between a save and its schedule. Never rejects. */
export function serial(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task, task).then(
    () => undefined,
    () => undefined,
  );
  chain = run;
  return run;
}

/** Sets the schedule from the stored choices: on each app start and when the plan's training days change. Reads the choices when its turn comes. */
export function restoreSchedule(db: StoreDb, profile: PlanProfile | null | undefined): Promise<void> {
  return serial(async () => applySchedule(await loadReminderPrefs(db), profile));
}

/** Cancels every alarm (the data was deleted). Never throws: a missing module or a failure leaves the next start to reconcile. */
export async function cancelReminders(): Promise<void> {
  try {
    await native?.cancelAll();
  } catch {
    // the next start sets the schedule from the (now empty) choices
  }
}

/** True where reminders can be scheduled (an Android build with the module). */
export const remindersAvailable = (): boolean => native !== null;
