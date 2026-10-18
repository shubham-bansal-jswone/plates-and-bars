import type { PlanProfile } from '@plate-and-bar/core';
import { NOTIFICATIONS } from './copy';
import native, { type NativeRule } from './native';
import { buildSlots, type ReminderPrefs } from './schedule';

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
