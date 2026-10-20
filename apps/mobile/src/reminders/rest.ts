import { REST_EXTEND_SEC } from '@plate-and-bar/core';
import { REST_NOTE } from './copy';
import native, { type RestEcho } from './native';

/** The rest timer notification (#1068). Rules only: what to hand the Android module, and how its echo changes the rest. */

/** What the app needs of the rest it keeps in `WorkoutScreen`. */
export interface RestLike {
  id: number;
  end: number;
  total: number;
}

/**
 * Shows the countdown for a rest that is running, for when the app is in the background. Returns false, and shows nothing, when
 * the rest is already over (a stale end time never alerts), when notifications are not allowed, or where there is no module.
 * Never throws: the in-app timer does not depend on it.
 */
export async function showRestNotification(rest: Pick<RestLike, 'id' | 'end'>, now: number): Promise<boolean> {
  if (!native || rest.end <= now) return false;
  try {
    if ((await native.getPermissionStatus()) !== 'granted') return false;
    await native.showRest({ id: rest.id, end: rest.end, extendMs: REST_EXTEND_SEC * 1000, ...REST_NOTE });
    return true;
  } catch {
    return false;
  }
}

/** Removes the notification and reads what its buttons did. Null when there is nothing or no module. Never throws. */
export async function takeRestNotification(): Promise<RestEcho | null> {
  try {
    return (await native?.takeRest()) ?? null;
  } catch {
    return null;
  }
}

/**
 * The rest as it stands after the notification's buttons: Skip ends it, +30 s moves the end (and lengthens the total, as the
 * in-app +30 s does). An echo for another rest (the id differs) changes nothing. The phone's rest stays the one that counts.
 */
export function applyEcho<T extends RestLike>(rest: T | null, echo: RestEcho | null): T | null {
  if (!rest || !echo || echo.id !== rest.id) return rest;
  if (echo.skipped) return null;
  if (echo.end <= rest.end) return rest;
  return { ...rest, end: echo.end, total: rest.total + Math.round((echo.end - rest.end) / 1000) };
}
