import measuresContent from '../../../../content/measures.json';
import type { MeasureKey } from '@plate-and-bar/core';
import { contentReader, isObj, isStr, isText, perLoad } from '../content/reader';

/** One tape measure from content/measures.json. */
export interface MeasureDef {
  key: MeasureKey;
  label: string;
  /** `always`, or the hips rule: shown for women, or when entered that day. */
  show: 'always' | { sex: string; or_entered_that_day: boolean };
}

/** The six tape parts core reads and the contract `Measurement` stores (without `_cm`). */
const MEASURE_KEYS: readonly string[] = ['waist', 'neck', 'chest', 'arm', 'thigh', 'hips'];
const isShow = (v: unknown): boolean =>
  v === 'always' || (isObj(v) && (v.sex === 'male' || v.sex === 'female') && typeof v.or_entered_that_day === 'boolean');
interface MeasuresBundle { unit: string; measures: { key: string; label: string; show: MeasureDef['show'] }[] }

/**
 * A stored measures copy must be in cm, with only known parts (each once, a label of 1 to 200 characters, a show rule the
 * screen understands) and every part the shipped copy has: body-fat and the waist chart read waist, neck and hips by key.
 */
const isMeasures = (v: unknown): v is MeasuresBundle => {
  if (!isObj(v) || v.unit !== 'cm' || !Array.isArray(v.measures)) return false;
  const seen = new Set<string>();
  for (const m of v.measures) {
    if (!isObj(m) || !isStr(m.key) || !MEASURE_KEYS.includes(m.key) || seen.has(m.key) || !isText(200)(m.label) || !isShow(m.show)) return false;
    seen.add(m.key);
  }
  return MEASURE_KEYS.every((k) => seen.has(k));
};

/** The single accept or reject decision for the measures bundle. */
export const chosenMeasures = contentReader('measures', measuresContent as unknown as MeasuresBundle, isMeasures);

/** The tape parts, in content order. Call it where it is used, not at module level. */
export const getMeasures: () => readonly MeasureDef[] = perLoad(() =>
  chosenMeasures().measures.map((m) => ({ key: `${m.key}_cm` as MeasureKey, label: m.label, show: m.show })),
);

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

// Weekly check-in, burn card and habits (prototype `renderCheckin`, `consistencyHtml`).
export const CHECKIN_TITLE = 'Weekly check-in';
export const CHECKIN_NEEDS_SETUP = 'Run setup (Targets tab) to see your weekly check-in.';
export const WEIGHT_WEEK_NONE = 'Weight: log at least 3 weigh-ins a week to see your weekly trend.';
export const BURN_TITLE = 'Calorie burn from your real data';
export const BURN_HOW = 'If you eat about the same each day and your weight trend changes, the difference shows your real burn: about 7,700 kcal equals 1 kg of body weight. This is usually more accurate than any formula or fitness tracker. It’s smoothed week to week so one odd week doesn’t swing your targets.';
export const NOT_NOW = 'Not now';
export const STOP_SUGGESTING = 'Stop suggesting this';
export const KEEP_TARGETS = 'Keep current targets';
export const HABIT_MESSAGE = {
  streak: (weeks: number, goal: number): string => `${weeks} weeks in a row with ${goal}+ sessions. That’s how habits form.`,
  missed: 'Missed a few days? No problem. Pick up with your next meal or session; one week never undoes progress.',
  steady: 'Aim for most days, not perfect days. Consistency over weeks is what counts.',
} as const;
export const SETTINGS_UNREADABLE = 'Couldn’t read your saved settings, so changes are not saved. Restart the app to try again.';
