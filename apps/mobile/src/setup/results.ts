import { DEFICIT_CAP_KCAL, needsClearance, setupSummary, type SetupNote, type TargetsResult } from '@plate-and-bar/core';
import { fmt } from '../format';
import type { Profile } from './types';

// View model for the results screen: the prototype's `setupResultHtml` copy around `setupSummary` values.

export interface Results {
  r: TargetsResult;
  headline: string;
  range: string;
  pace: string;
  rows: [label: string, kcal: number][];
  notes: string[];
}

export function buildResults(p: Profile): Results {
  const s = setupSummary(p);
  const r = s.targets;
  const pace =
    s.pace === 'loss'
      ? `That’s ${s.deficitPct}% below your burn, about ${s.paceKg} kg of weight loss a week on average.`
      : s.pace === 'gain'
        ? `That’s a small surplus, about ${s.paceKg} kg of gain a week.`
        : 'That matches your burn, so your weight should hold steady.';
  const copy: Record<SetupNote, string> = {
    special: 'During pregnancy or breastfeeding the app doesn’t set a calorie deficit. Please check these targets with your doctor.',
    floored: `Your target stops at ${fmt(r.floor)} kcal, the lowest this app suggests for ${p.sex === 'male' ? 'men' : 'women'} (a common rule of thumb, not a strict medical limit). Going lower makes it hard to keep muscle and energy.`,
    screen:
      'You answered yes to a health check question. Please check with a doctor before starting; until you confirm, sessions stay light with no weight increases.',
    home_dumbbells: 'Home plan: dumbbell versions with higher rep ranges (10–20).',
    home_bodyweight: 'Home plan: bodyweight exercises that progress to harder versions, plus backpack rows for your back.',
    older:
      'For 60 and over, your plan adds a short balance exercise to each session, uses smaller weight jumps, and gives every main meal at least 25 g of protein.',
    capped: `The deficit is capped at ${DEFICIT_CAP_KCAL} kcal a day to protect muscle and training energy.`,
  };
  return {
    r,
    headline: `You burn about ${fmt(r.tdee)} kcal a day`,
    range: `Likely range ${fmt(s.burnLow)}–${fmt(s.burnHigh)}. After a few weeks of logging, your real weight trend will sharpen this.`,
    pace,
    rows: [
      ['Resting', r.bmr],
      ['Daily movement', r.movement],
      ['Training, weekly average', r.training],
      ['Digestion', r.digestion],
    ],
    notes: s.notes.map((n) => copy[n]),
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
