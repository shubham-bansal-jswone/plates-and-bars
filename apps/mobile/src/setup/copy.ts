import type { Activity, Experience, Goal, Pace, Where } from '@plate-and-bar/core';

// Setup copy, taken from docs/prototype/plate-and-bar.html. Moves into a content bundle once one exists.

export const CONSENT_TEXT_VERSION = '2026-10-07';

export const CONSENT = {
  title: 'Before you start',
  intro:
    'Plate & Bar tracks food, training, body measurements and, if you choose, photos, cycle data and lab results. That’s health data, so here’s how it’s handled:',
  bullets: [
    'Food, workouts, weight and measurements are saved privately to your Claude account so they sync between devices.',
    'Progress photos, cycle logs and lab reports stay only on this device.',
    'Meal photos, recipe imports and form-check frames are sent to Claude for analysis and not stored.',
    'You can download or delete everything at any time on the Targets tab.',
  ],
  note: 'This app gives general fitness and nutrition guidance. It isn’t medical advice. It’s for adults 18 and over; if you have a medical condition, are pregnant, or are unsure whether exercise is safe for you, check with a doctor first.',
  checkbox: 'I understand and agree to my data being stored as described',
  needsTick: 'Tick the box to continue.',
};

export const SCREEN_Q = [
  'Has a doctor told you that you have a heart condition or high blood pressure?',
  'Do you get chest pain at rest, during daily activities or when you exercise?',
  'In the past 12 months, have you lost balance from dizziness or lost consciousness?',
  'Do you have another long-term medical condition, or take prescribed medicine for one?',
  'Do you have a bone, joint or muscle problem that more activity could make worse?',
  'Has a doctor said you should only exercise under medical supervision?',
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
