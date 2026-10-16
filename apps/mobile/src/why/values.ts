import { fibreTarget, splitFor } from '@plate-and-bar/core';
import cardsContent from '../../../../content/cards.json';
import { fmt } from '../format';
import { buildResults } from '../setup/results';
import type { Profile } from '../setup/types';
import type { WhyValues } from './cards';

const SPLIT_NAMES = (cardsContent as unknown as { split_names: Record<string, string> }).split_names;

/** The `split` card's values (prototype `KB.split.b`): days and split name from core's split, session length, and the new-lifter section. */
function splitWhyValues(profile: Profile): WhyValues {
  const days = splitFor(profile).list.length;
  return {
    days,
    split_name: SPLIT_NAMES[String(days)],
    minutes: profile.minutes ?? undefined,
    new_lifter: profile.exp === 'new' ? 1 : undefined,
  };
}

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
    ...splitWhyValues(profile),
  };
}
