// Display text for the "can’t do" sheet and the avoid list, from the prototype (REASONS, PATTERN, FAMILY, ruleText).
// Muscle and joint labels are in content/labels.json; these two are not in content yet.
import type { Exclusion, ExclusionReason } from '@plate-and-bar/core';
import { jointLabel } from './reasons';

export const REASONS: [ExclusionReason, string][] = [
  ['pain', 'Pain or an injury'],
  ['equip', 'Equipment isn’t available'],
  ['dislike', 'I don’t like it'],
  ['form', 'Not confident with the form'],
];

export const DURATIONS: [string, string][] = [
  ['today', 'Just today'],
  ['2w', 'For 2 weeks, then check again'],
  ['4w', 'For 4 weeks, then check again'],
  ['perm', 'Permanently'],
];

export const PATTERN: Record<string, string> = { 'h-press':'chest pressing', 'v-press':'overhead pressing', fly:'chest flyes', raise:'lateral raises', rear:'rear-shoulder work', tri:'triceps extensions', dip:'dips', 'v-pull':'vertical pulling', 'h-pull':'rows', curl:'curls', squat:'squats', lunge:'lunges and split squats', hinge:'hip hinges (deadlift-type)', 'hip-ext':'hip thrusts and bridges', 'knee-ext':'leg extensions', 'knee-flex':'leg curls', calf:'calf raises', 'core-flex':'crunches and leg raises', 'core-stab':'planks' };

export const FAMILY: Record<string, string> = { bench:'bench press variations', chestpress:'machine chest presses', pushup:'push-up variations', fly:'fly variations', ohp:'overhead press variations', lateral:'lateral raise variations', rear:'rear-delt variations', pushdown:'pushdown variations', 'overhead-ext':'overhead extension variations', dips:'dip variations', pulldown:'pulldown variations', pullup:'pull-up variations', row:'row variations', curl:'curl variations', squat:'squat variations', lunge:'lunge variations', legext:'leg extension variations', legcurl:'leg curl variations', thrust:'hip thrust and bridge variations', hinge:'deadlift variations', calf:'calf raise variations', crunch:'crunch variations', legraise:'leg raise variations', plank:'plank variations' };

/** What a rule leaves out ("All bench press variations"); prototype `ruleText` before the comma. */
export function ruleWhat(r: Pick<Exclusion, 'scope' | 'key'>): string {
  return r.scope === 'exercise' ? r.key : r.scope === 'family' ? `All ${FAMILY[r.key] ?? r.key}` : r.scope === 'pattern' ? `All ${PATTERN[r.key] ?? r.key}` : `Anything that loads the ${jointLabel(r.key)}`;
}
