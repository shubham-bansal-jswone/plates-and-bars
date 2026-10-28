import type { Activity, Experience, Goal, Pace, Where } from '@plate-and-bar/core';

// Setup copy, taken from docs/prototype/plate-and-bar.html. Moves into a content bundle once one exists.

export const CONSENT_TEXT_VERSION = '2026-10-17';

export const CONSENT = {
  title: 'Before you start',
  intro:
    'Plate & Bar tracks food, training, body measurements and, if you choose, photos, cycle data and lab results. That’s health data, so here’s how it’s handled:',
  bullets: [
    'Your data stays on this device. If you sign in, it is also stored on our own server so it syncs between your devices.',
    'Progress photos, cycle logs and lab reports stay only on this device.',
    'AI features are off by default and need their own opt-in. No photos are sent anywhere.',
    'You can download or delete everything at any time on the Targets tab.',
    'Withdrawing your consent means deleting your account.',
  ],
  note: 'This app gives general fitness and nutrition guidance. It isn’t medical advice. It’s for adults 18 and over; if you have a medical condition, are pregnant, or are unsure whether exercise is safe for you, check with a doctor first.',
  checkbox: 'I understand and agree to my data being stored as described',
  needsTick: 'Switch this on to continue.',
};

export const SCREEN_Q = [
  'Have you ever been diagnosed with a heart problem or high blood pressure?',
  'Does your chest hurt when you are resting or being active?',
  'In the last year, have you fainted, or felt so dizzy that you fell or nearly fell?',
  'Do you live with a long-term health condition, or take regular medication for one?',
  'Do you have a back, knee, shoulder or other bone, joint or muscle problem that being more active could make worse?',
  'Has a doctor or other health professional said you should only exercise with supervision?',
] as const;

type Choice = readonly [label: string, sub: string];
export const ACTIVITY: Record<Activity, Choice> = {
  sitting: ['Mostly sitting', 'Desk job, little walking (under ~5,000 steps)'],
  light: ['Some walking', 'Errands and short walks (~5,000–7,500 steps)'],
  feet: ['On my feet a lot', 'Retail, teaching, lots of walking (~10,000 steps)'],
  physical: ['Physical work', 'Labour, deliveries, a very active job'],
};
export const GOALS: Record<Goal, Choice> = {
  lose: ['Lose fat', 'Steady fat loss while keeping muscle'],
  recomp: ['Lose fat and build muscle', 'Smaller deficit, slower change on the scale'],
  maintain: ['Maintain', 'Keep weight steady and get stronger'],
  gain: ['Build muscle', 'A small surplus to support muscle gain'],
};
export const PACES: Record<Pace, Choice> = {
  gentle: ['Gentle', 'Easier to stick with'],
  moderate: ['Moderate', 'Faster, still muscle-friendly'],
};
export const WHERE: Record<Where, Choice> = {
  gym: ['At a gym', 'Machines, cables, barbells and dumbbells'],
  dumbbells: ['At home with dumbbells', 'Adjustable dumbbells or a few pairs'],
  bodyweight: ['At home, no equipment', 'Bodyweight, plus a backpack for rows'],
};
export const EXPERIENCE: Record<Experience, Choice> = {
  new: ['New to lifting', 'Less than 6 months, or a long break'],
  some: ['Some experience', '6 months to 2 years of regular training'],
  exp: ['Experienced', 'More than 2 years'],
};
