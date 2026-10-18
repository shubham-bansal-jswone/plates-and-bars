// Cycle log copy (prototype `cycleHtml`, the `cyc-*` actions and the check-in weight line). Device only, never uploaded.
export const CYCLE_TITLE = 'Cycle log';
export const CYCLE_INTRO = 'Optional. Water retention around your period can move the scale by a kilo or more; tracking it lets the app compare like with like. Kept only on this device.';
export const CYCLE_TURN_ON = 'Turn on';
export const CYCLE_START_HINT = 'Log the first day of your period to start.';
export const CYCLE_WATER_NOTE = 'Water retention is common around now, so the scale may read higher. Compare with the same phase of your last cycle, not with last week.';
export const CYCLE_LATE = 'Your period seems later than usual. Log it when it starts.';
export const CYCLE_DAY = (day: number): string => `Day ${day}`;
export const CYCLE_OF = (len: number, phase: string): string => ` of about ${len}, ${phase}.`;
export const CYCLE_SAME_DAY = (date: string, kg: string): string => `Same day last cycle (${date}): ${kg} kg.`;
export const CYCLE_DATE_LABEL = 'Date your period started';
export const CYCLE_DATE_PLACEHOLDER = 'YYYY-MM-DD';
export const CYCLE_DATE_BAD = 'Enter the date as YYYY-MM-DD, today or earlier.';
export const CYCLE_LOG = 'Period started';
export const CYCLE_LOGGED = 'Logged';
export const CYCLE_LOGGED_LIST = (dates: string): string => `Logged: ${dates}.`;
export const CYCLE_REMOVE_LAST = 'Remove last';
export const CYCLE_PRIVATE = 'Kept only on this device, never uploaded.';
export const CYCLE_OFF = 'Turn off and delete';
export const CYCLE_DELETED = 'Cycle log deleted';
export const CYCLE_SAVE_FAILED = 'Couldn’t save the cycle log. Try again.';
/** Check-in weight line, appended in the period and luteal phases (prototype `renderCheckin`). */
export const CYCLE_CHECKIN_NOTE = 'This is the part of your cycle when water retention is common, so read the scale loosely.';
/** How many logged starts are listed (prototype: the last 4). */
export const CYCLE_LIST = 4;
