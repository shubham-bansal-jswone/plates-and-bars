import { splitFor, type PlanProfile } from '@plate-and-bar/core';

/** Local reminders (#943). Pure rules: what to schedule from the stored choices. The Android module only fires what it is given. */

export type ClockTime = string; // "HH:MM", 24 h

export type FixedId = 'weigh_in' | 'workout' | 'lunch' | 'dinner';
export const FIXED_IDS: readonly FixedId[] = ['weigh_in', 'workout', 'lunch', 'dinner'];
export const WATER_EVERY = [2, 3, 4] as const;
export type WaterEvery = (typeof WATER_EVERY)[number];

export interface ReminderPrefs {
  weigh_in: { on: boolean; time: ClockTime };
  workout: { on: boolean; time: ClockTime };
  lunch: { on: boolean; time: ClockTime };
  dinner: { on: boolean; time: ClockTime };
  water: { on: boolean; every_h: WaterEvery };
  /** The rest timer as a notification while the app is in the background (#1068). Not a schedule: the workout screen drives it. */
  rest: { on: boolean };
  /** No reminder fires from `from` (inclusive) until `to` (exclusive); may cross midnight. */
  quiet: { from: ClockTime; to: ClockTime };
}

/** Everything off until the user turns a reminder on. */
export const DEFAULT_PREFS: ReminderPrefs = {
  weigh_in: { on: false, time: '07:30' },
  workout: { on: false, time: '17:30' },
  lunch: { on: false, time: '13:30' },
  dinner: { on: false, time: '20:30' },
  water: { on: false, every_h: 3 },
  rest: { on: false },
  quiet: { from: '22:00', to: '07:00' },
};

/** Water starts at this time of day and repeats while it is awake. */
const WATER_START = 9 * 60;
const DAY = 24 * 60;

/** Minutes since midnight for "HH:MM", or null when it is not a valid 24 h time. */
export function minutesOf(t: unknown): number | null {
  if (typeof t !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type ClockInput = { ok: true; time: ClockTime } | { ok: false; error: string };

export const CLOCK_ERRORS = {
  empty: 'Enter a time, like 07:30.',
  shape: 'Use a time like 07:30 or 0730.',
  range: 'Hours go from 00 to 23 and minutes from 00 to 59.',
} as const;

/**
 * Reads a time as people type it on a number pad: "0815", "815", "8.15", "8:15" or "08:15" all give "08:15". Without a
 * separator the last two digits are the minutes; with one, the minutes are exactly two digits.
 */
export function parseClock(input: string): ClockInput {
  const t = input.trim();
  if (t === '') return { ok: false, error: CLOCK_ERRORS.empty };
  const m = /^(\d{1,2})[.:](\d{2})$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m) return { ok: false, error: CLOCK_ERRORS.shape };
  const time = `${m[1]!.padStart(2, '0')}:${m[2]}`;
  return minutesOf(time) === null ? { ok: false, error: CLOCK_ERRORS.range } : { ok: true, time };
}

export function clock(minutes: number): ClockTime {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** True when `minute` (of the day) is inside the quiet window. Equal start and end means no quiet hours. */
export function inQuiet(minute: number, quiet: ReminderPrefs['quiet']): boolean {
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === null || to === null || from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Reads the stored JSON. Anything missing or invalid falls back to the default for that field, so a bad value never turns a reminder on. */
export function parsePrefs(raw: string | null): ReminderPrefs {
  let o: Record<string, Record<string, unknown> | undefined> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object') o = v as typeof o;
  } catch {
    // keep the defaults
  }
  const time = (v: unknown, d: ClockTime): ClockTime => (minutesOf(v) !== null ? (v as ClockTime) : d);
  const fixed = (id: FixedId) => ({ on: o[id]?.on === true, time: time(o[id]?.time, DEFAULT_PREFS[id].time) });
  const every = WATER_EVERY.find((n) => n === o.water?.every_h) ?? DEFAULT_PREFS.water.every_h;
  return {
    weigh_in: fixed('weigh_in'),
    workout: fixed('workout'),
    lunch: fixed('lunch'),
    dinner: fixed('dinner'),
    water: { on: o.water?.on === true, every_h: every },
    rest: { on: o.rest?.on === true },
    quiet: { from: time(o.quiet?.from, DEFAULT_PREFS.quiet.from), to: time(o.quiet?.to, DEFAULT_PREFS.quiet.to) },
  };
}

/** A reminder as the schedule holds it. `days` are weekdays, 0 = Sunday. */
export interface Slot {
  id: string;
  /** Which copy and deep link to use. */
  kind: FixedId | 'water';
  minute: number;
  days: number[];
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * The reminders to schedule. A time inside the quiet hours moves to where they end; water times inside them are dropped.
 * The workout reminder follows the plan: its days come from core's `splitFor(profile)` (none for a 0-day plan, so none is set).
 */
export function buildSlots(prefs: ReminderPrefs, profile: PlanProfile | null | undefined): Slot[] {
  const slots: Slot[] = [];
  const quietEnd = minutesOf(prefs.quiet.to) ?? 0;
  for (const id of FIXED_IDS) {
    const p = prefs[id];
    if (!p.on) continue;
    const set = minutesOf(p.time);
    if (set === null) continue;
    const days = id === 'workout' ? [...splitFor(profile).days] : EVERY_DAY;
    if (days.length === 0) continue;
    slots.push({ id, kind: id, minute: inQuiet(set, prefs.quiet) ? quietEnd : set, days });
  }
  if (prefs.water.on) {
    // From WATER_START every `every_h` hours, as long as it is the same day.
    for (let m = WATER_START, i = 0; m < DAY; m += prefs.water.every_h * 60, i++) {
      if (!inQuiet(m, prefs.quiet)) slots.push({ id: `water_${i}`, kind: 'water', minute: m, days: EVERY_DAY });
    }
  }
  return slots;
}

/** True when the time of a fixed reminder was moved because it falls in the quiet hours. */
export function movedByQuiet(prefs: ReminderPrefs, id: FixedId): boolean {
  const m = minutesOf(prefs[id].time);
  return m !== null && inQuiet(m, prefs.quiet);
}
