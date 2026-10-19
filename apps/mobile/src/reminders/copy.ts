import type { Slot } from './schedule';

/**
 * Notification text and where a tap goes. Plain and short; never a weight, food or health detail (it shows on the lock screen).
 * Routes are the app's own scheme, resolved by Expo Router: Food is the index tab.
 */
export const NOTIFICATIONS: Record<Slot['kind'], { title: string; body: string; route: string }> = {
  weigh_in: { title: 'Weigh-in', body: 'A quick weigh-in keeps your trend honest.', route: 'plateandbar://progress' },
  workout: { title: 'Workout day', body: 'Your session is ready when you are.', route: 'plateandbar://workout' },
  lunch: { title: 'Log lunch', body: 'Add what you ate while you remember it.', route: 'plateandbar://' },
  dinner: { title: 'Log dinner', body: 'Add what you ate while you remember it.', route: 'plateandbar://' },
  water: { title: 'Water', body: 'A glass now keeps you on target.', route: 'plateandbar://' },
};

export const SECTION = {
  title: 'Reminders',
  intro: 'Off until you turn one on. They are set on this phone only and never leave it.',
  quietHint: 'No reminders during quiet hours. A reminder set inside them goes off when they end.',
  denied: 'Notifications are off for Plate & Bar. Turn them on in your phone’s settings to get reminders.',
  unavailable: 'Reminders are not available on this device yet.',
  saveFailed: 'Couldn’t save that on this device. Try again.',
  restHint: 'While you rest and the app is in the background, shows the countdown, and tells you when it ends. Your watch shows it too.',
} as const;

/** The rest-timer notification (#1068). Generic on purpose: it shows on the lock screen and on a watch. */
export const REST_NOTE = {
  title: 'Rest',
  body: 'Back to your workout when the timer ends.',
  doneTitle: 'Rest done, go!',
  doneBody: 'Your next set is ready.',
  extendLabel: '+30 s',
  skipLabel: 'Skip rest',
} as const;

export const LABELS = {
  weigh_in: 'Weigh-in',
  workout: 'Workout days',
  lunch: 'Log lunch',
  dinner: 'Log dinner',
  water: 'Water',
  rest: 'Rest timer notifications',
} as const;
