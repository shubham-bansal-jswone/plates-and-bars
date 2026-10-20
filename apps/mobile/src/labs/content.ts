import labsContent from '../../../../content/labs.json';
import type { MarkerKey, TipKind } from '@plate-and-bar/core';

/**
 * content/labs.json: the lab-report wording (tips, notices). Read from the shipped copy only, never from a server copy: this is
 * medical wording that was reviewed as shipped, so it changes with an app release (#1070). Core holds none of it.
 */
export interface LabsContent {
  not_medical_advice: string;
  intro: string;
  check_values: string;
  red_notice: string;
  generic_notice: string;
  unit_unrecognised: string;
  all_within_range: string;
  hold_title: string;
  hold_body: string;
  workout_note: string;
  markers: Partial<Record<MarkerKey, Partial<Record<'low' | 'high', string>>>>;
}

export const labs: LabsContent = labsContent as unknown as LabsContent;

/** The text for the tip `tipFor` chose: the red notice, the marker's tip for that side, or the generic notice. */
export function tipText(kind: TipKind, marker: MarkerKey | null): string {
  if (kind === 'red') return labs.red_notice;
  if (kind === 'generic' || !marker) return labs.generic_notice;
  return labs.markers[marker]?.[kind] ?? labs.generic_notice;
}
