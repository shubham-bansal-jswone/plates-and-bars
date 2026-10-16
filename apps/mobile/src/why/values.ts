import { fibreTarget } from '@plate-and-bar/core';
import { fmt } from '../format';
import { buildResults } from '../setup/results';
import type { Profile } from '../setup/types';
import type { WhyValues } from './cards';

/** Values for the card placeholders that the stored setup can fill: the targets, the burn breakdown and the fibre target (#550). */
export function profileWhyValues(profile: Profile): WhyValues {
  const { r } = buildResults(profile);
  return {
    kcal: fmt(profile.targets.kcal),
    protein_g: profile.targets.protein_g,
    tdee: fmt(r.tdee),
    bmr: fmt(r.bmr),
    movement: fmt(r.movement),
    training: fmt(r.training),
    digestion: fmt(r.digestion),
    fibre_g: fibreTarget(profile.targets.kcal),
  };
}
