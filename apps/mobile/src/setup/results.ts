import { calcTargets, needsClearance, older, screenFlag, type TargetsResult } from '@plate-and-bar/core';
import { fmt } from '../format';
import { toTargetsProfile } from './logic';
import type { Profile } from './types';

// View model for the results screen: the prototype's `setupResultHtml` text, from `calcTargets` output.

export interface Results {
  r: TargetsResult;
  headline: string;
  range: string;
  pace: string;
  rows: [label: string, kcal: number][];
  notes: string[];
}

const r1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function buildResults(p: Profile): Results {
  const r = calcTargets(toTargetsProfile(p));
  const pct = Math.round(((r.tdee - r.kcal) / r.tdee) * 100);
  const pace =
    r.kcal < r.tdee - 20
      ? `That’s ${pct}% below your burn, about ${r1(-r.weekly)} kg of weight loss a week on average.`
      : r.kcal > r.tdee + 20
        ? `That’s a small surplus, about ${r1(r.weekly)} kg of gain a week.`
        : 'That matches your burn, so your weight should hold steady.';
  const notes: string[] = [];
  if (r.special)
    notes.push('During pregnancy or breastfeeding the app doesn’t set a calorie deficit. Please check these targets with your doctor.');
  if (r.floored)
    notes.push(
      `Your target stops at ${fmt(r.floor)} kcal, the lowest this app suggests for ${p.sex === 'male' ? 'men' : 'women'} (a common rule of thumb, not a strict medical limit). Going lower makes it hard to keep muscle and energy.`,
    );
  if (screenFlag(p))
    notes.push(
      'You answered yes to a health check question. Please check with a doctor before starting; until you confirm, sessions stay light with no weight increases.',
    );
  if (p.where !== 'gym')
    notes.push(
      `Home plan: ${p.where === 'dumbbells' ? 'dumbbell versions with higher rep ranges (10–20)' : 'bodyweight exercises that progress to harder versions, plus backpack rows for your back'}.`,
    );
  if (older({ ...p, exp: p.exp ?? undefined }))
    notes.push(
      'For 60 and over, your plan adds a short balance exercise to each session, uses smaller weight jumps, and gives every main meal at least 25 g of protein.',
    );
  if (r.capped) notes.push('The deficit is capped at 750 kcal a day to protect muscle and training energy.');
  return {
    r,
    headline: `You burn about ${fmt(r.tdee)} kcal a day`,
    range: `Likely range ${fmt(r.tdee * 0.9)}–${fmt(r.tdee * 1.1)}. After a few weeks of logging, your real weight trend will sharpen this.`,
    pace,
    rows: [
      ['Resting', r.bmr],
      ['Daily movement', r.movement],
      ['Training, weekly average', r.training],
      ['Digestion', r.digestion],
    ],
    notes,
  };
}

/** Prototype `clearanceNoteHtml` text; null when no clearance is needed. */
export function clearanceNote(p: Profile): { title: string; body: string } | null {
  if (!needsClearance(p)) return null;
  return {
    title: 'Check with your doctor first',
    body: `${p.special === 'pregnant' ? 'During pregnancy, follow your doctor’s or midwife’s advice on exercise.' : 'Your health check suggests getting a doctor’s OK before starting a new training plan.'} Until then, sessions stay light with no weight increases.`,
  };
}
