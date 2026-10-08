import type { ExType, Rate } from '@plate-and-bar/core';

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

export const MUSCLE: Record<string, string> = {
  chest: 'chest',
  'front-delt': 'front shoulders',
  'side-delt': 'side shoulders',
  'rear-delt': 'rear shoulders',
  triceps: 'triceps',
  lats: 'lats',
  'upper-back': 'upper back',
  biceps: 'biceps',
  forearms: 'forearms',
  quads: 'quads',
  hams: 'hamstrings',
  glutes: 'glutes',
  calves: 'calves',
  abs: 'abs',
  'lower-back': 'lower back',
};

export const RATE_LABEL: Record<Rate, string> = { easy: 'Easy', right: 'Just right', hard: 'Hard', fail: 'Couldn’t finish' };
export const RATE_ORDER: Rate[] = ['easy', 'right', 'hard', 'fail'];

export const CHECKIN: { key: 'sleep' | 'sore' | 'energy' | 'time'; label: string; options: [string, string][] }[] = [
  { key: 'sleep', label: 'Sleep last night', options: [['good', 'Good'], ['ok', 'OK'], ['poor', 'Poor']] },
  { key: 'sore', label: 'Soreness in today’s muscles', options: [['none', 'None'], ['some', 'Some'], ['very', 'Very sore']] },
  { key: 'energy', label: 'Energy', options: [['good', 'Good'], ['ok', 'OK'], ['low', 'Low']] },
  { key: 'time', label: 'Time today', options: [['usual', 'Usual'], ['45', '45 min'], ['30', '30 min']] },
];

/** "a, b and c". Mirrors the prototype's `listJoin`. */
export function listJoin(a: string[]): string {
  return a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}
