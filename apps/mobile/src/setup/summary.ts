import { cmToFtIn, setupSummary, type WeightUnit } from '@plate-and-bar/core';
import { fmt } from '../format';
import { ACTIVITY, GOALS } from './copy';
import type { Profile } from './types';
import { weightWithUnit } from '../workout/unitText';

// The Targets "Your setup" block: prototype `setupSummaryHtml`. The numbers come from core; this is the wording.

export interface SetupText {
  /** "Male, 30, 5′5″, 82 kg. Mostly sitting; 6 sessions a week of about 60 min. Goal: lose fat." */
  line: string;
  /** "Estimated burn: about 2,700 kcal a day." */
  burn: string;
}

export function setupText(p: Profile, unit: WeightUnit = 'kg'): SetupText {
  // Setup stores the height in cm and shows it as feet and inches, as the prototype's `heightText` does.
  const { ft, inch } = cmToFtIn(p.height_cm);
  const training = p.days ? `${p.days} sessions a week of about ${p.minutes} min` : 'no regular training yet';
  return {
    line: `${p.sex === 'male' ? 'Male' : 'Female'}, ${p.age}, ${ft}′${inch}″, ${weightWithUnit(p.weight_kg, unit)}. ${ACTIVITY[p.activity][0]}; ${training}. Goal: ${GOALS[p.goal][0].toLowerCase()}.`,
    burn: `Estimated burn: about ${fmt(setupSummary(p).targets.tdee)} kcal a day.`,
  };
}
