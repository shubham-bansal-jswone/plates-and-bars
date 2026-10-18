/** Words for the phone step counter (Targets > Phone step counter, #300). */
export const STEPS_COPY = {
  title: 'Phone step counter',
  label: 'Count steps with this phone',
  off: 'Off by default. You can always type your steps in yourself; what you type is never overwritten by the phone.',
  how: 'When on, the app reads the step sensor in your phone each time you open it and fills in today’s steps. It counts from the moment you turn it on and only while the app is opened now and then, so a day can come out low. It uses no Google services. Each day’s step total is saved with that day and synced to your account like steps you type, when you are signed in; the raw sensor readings stay on this phone.',
  noSensor: 'This phone has no step sensor, so it can’t count steps. You can still type your steps in.',
  denied: 'Plate & Bar needs the “Physical activity” permission to read the step sensor. You can turn it on later in the phone’s Settings, under Apps, Plate & Bar, Permissions. Until then, type your steps in.',
  lost: 'The “Physical activity” permission was turned off in the phone’s Settings, so steps are not being counted. Turn it on there, or type your steps in.',
  /** Shown by us before the system dialog. */
  askTitle: 'Count your steps with this phone?',
  askBody: 'Plate & Bar reads your phone’s step sensor to fill in today’s steps. Android will ask for the “Physical activity” permission for this. Each day’s step total is saved with that day and synced to your account like steps you type, when you are signed in. The raw sensor readings stay on this phone.',
  askContinue: 'Continue',
  askCancel: 'Not now',
  /** Android’s own re-ask text, passed to the permission request. */
  rationale: { title: 'Physical activity', message: 'Plate & Bar needs this to read your phone’s step sensor and fill in today’s steps.', buttonPositive: 'OK', buttonNegative: 'Not now' },
} as const;
