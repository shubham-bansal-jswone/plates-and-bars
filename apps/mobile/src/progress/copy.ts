import measuresContent from '../../../../content/measures.json';
import type { MeasureKey } from '@plate-and-bar/core';

/** One tape measure from content/measures.json. */
export interface MeasureDef {
  key: MeasureKey;
  label: string;
  /** `always`, or the hips rule: shown for women, or when entered that day. */
  show: 'always' | { sex: string; or_entered_that_day: boolean };
}

export const MEASURES: readonly MeasureDef[] = measuresContent.measures.map((m) => ({
  key: `${m.key}_cm` as MeasureKey,
  label: m.label,
  show: m.show as MeasureDef['show'],
}));

// Messages from the prototype's Progress screen.
export const WEIGHT_HINT = 'Weigh in each morning before eating. Day-to-day swings of a kilo are normal; the weekly direction is what counts.';
export const WEIGHT_BAD = 'Enter your weight in kg, like 81.6';
export const MEASURE_NONE = 'Enter at least one measurement in cm.';
export const HOW_TO_MEASURE = 'Measure in the morning before eating, relaxed and not sucking in. Waist: around the navel. Neck: just below the Adam’s apple. Hips: the widest point. Keep the tape level and snug, not tight. Every 1–2 weeks is plenty.';
export const BF_HINT = (hips: boolean): string =>
  `From the US Navy formula using your waist, neck${hips ? ', hips' : ''} and height. It’s usually within a few percent; the trend matters more than the number.`;
export const BF_MISSING = (hips: boolean): string => `Add waist and neck${hips ? ' and hips' : ''} for a body-fat estimate.`;
export const BF_NO_PROFILE = 'Run setup (Targets tab) and add waist and neck for a body-fat estimate.';
export const STEPS_BAD = 'Enter steps as a whole number, like 8000.';
export const SLEEP_BAD = 'Enter hours slept, like 7.5.';
export const TREND_NONE = 'Log a few weigh-ins to see your trend line here.';
export const SCALE_JUMP_TITLE = (kg: number): string => `The scale went up ${kg} kg`;
export const SCALE_JUMP_BODY = 'That’s almost certainly water, not fat. Your weekly average is what counts.';
