import labels from '../../../../content/labels.json';
import type { ModsNotePart, Checkin, CheckinReason, ExType, Rate } from '@plate-and-bar/core';

// Display text from the prototype's workout screen (TYPE_LABEL, MUSCLE, RATES, CI_Q).

export const TYPE_LABEL: Record<ExType, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  machine: 'Machine',
  cable: 'Cable',
  assisted: 'Assisted machine',
  bodyweight: 'Bodyweight',
  other: 'Other',
  time: 'Timed hold',
};

export const MUSCLE: Record<string, string> = labels.muscles;

export const RATE_LABEL: Record<Rate, string> = { easy: 'Easy', right: 'Just right', hard: 'Hard', fail: 'Couldn’t finish' };
export const RATE_ORDER: Rate[] = ['easy', 'right', 'hard', 'fail'];

type Question = { [K in keyof Checkin]-?: { key: K; label: string; options: [NonNullable<Checkin[K]>, string][] } }[keyof Checkin];

export const CHECKIN: Question[] = [
  { key: 'sleep', label: 'Sleep last night', options: [['good', 'Good'], ['ok', 'OK'], ['poor', 'Poor']] },
  { key: 'sore', label: 'Soreness in today’s muscles', options: [['none', 'None'], ['some', 'Some'], ['very', 'Very sore']] },
  { key: 'energy', label: 'Energy', options: [['good', 'Good'], ['ok', 'OK'], ['low', 'Low']] },
  { key: 'time', label: 'Time today', options: [['usual', 'Usual'], ['45', '45 min'], ['30', '30 min']] },
];

/** The words for each reason the check-in suggests a lighter session. */
export const REASON_TEXT: Record<CheckinReason, string> = { sleep: 'poor sleep', energy: 'low energy', sore: 'very sore muscles' };

/** "a, b and c". Mirrors the prototype's `listJoin`. */
export function listJoin(a: string[]): string {
  return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

/** Copy for one part of the "Today: …" note (core's `modsNote` gives the codes). */
export function modsNoteText(p: ModsNotePart): string {
  switch (p.kind) {
    case 'deload':
      return 'recovery week: fewer sets, about 10% lighter';
    case 'reentry':
      return `easing back in: about ${p.pct}% lighter`;
    case 'light':
      return 'lighter session: 1 fewer set, no weight increases';
    case 'short':
      return 'short session: main exercises only';
    case 'where':
      return p.where === 'dumbbells' ? 'dumbbells-only version' : 'bodyweight version';
  }
}
