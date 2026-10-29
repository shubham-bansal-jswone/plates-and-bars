import measuresContent from '../../../../content/measures.json';
import { KCAL_PER_KG, KCAL_PER_LB, RAPID_LOSS_KCAL, type MeasureKey, type SeriesRange, type WeightUnit } from '@plate-and-bar/core';
import { contentReader, isObj, isStr, isTrimmedText, perLoad } from '../content/reader';

/** One tape measure from content/measures.json. */
export interface MeasureDef {
  key: MeasureKey;
  label: string;
  /** `always`, or the hips rule: shown for women, or when entered that day. */
  show: 'always' | { sex: string; or_entered_that_day: boolean };
}

/** The six tape parts core reads and the contract `Measurement` stores (without `_cm`). */
type Part = MeasureKey extends `${infer K}_cm` ? K : never;
const MEASURE_KEYS = ['waist', 'neck', 'chest', 'arm', 'thigh', 'hips'] as const satisfies readonly Part[];
// Compile-time: every core MeasureKey is listed, so a rename or an added part fails to compile here.
const _allParts: Exclude<Part, (typeof MEASURE_KEYS)[number]> extends never ? true : never = true;
void _allParts;
const KEYS: readonly string[] = MEASURE_KEYS;
const isShow = (v: unknown): boolean =>
  v === 'always' || (isObj(v) && (v.sex === 'male' || v.sex === 'female') && typeof v.or_entered_that_day === 'boolean');
/** The one rule a part may carry besides `always`: hips for women, or when entered that day (as the shipped copy has it). */
const isHipsRule = (v: unknown): boolean => isObj(v) && v.sex === 'female' && v.or_entered_that_day === true;
interface MeasuresBundle { unit: string; measures: { key: string; label: string; show: MeasureDef['show'] }[] }

/**
 * A stored measures copy must be in cm, with only known parts (each once, a label of 1 to 200 characters, a show rule the
 * screen understands) and every part the shipped copy has: body-fat and the waist chart read waist, neck and hips by key.
 */
const isMeasures = (v: unknown): v is MeasuresBundle => {
  if (!isObj(v) || v.unit !== 'cm' || !Array.isArray(v.measures)) return false;
  const seen = new Set<string>();
  for (const m of v.measures) {
    if (!isObj(m) || !isStr(m.key) || !KEYS.includes(m.key) || seen.has(m.key) || !isTrimmedText(200)(m.label) || !isShow(m.show)) return false;
    // Body fat and the waist chart read waist and neck, and hips is only for women: a copy must not change those rules.
    if ((m.key === 'waist' || m.key === 'neck') && m.show !== 'always') return false;
    if (m.key === 'hips' && m.show !== 'always' && !isHipsRule(m.show)) return false;
    seen.add(m.key);
  }
  return KEYS.every((k) => seen.has(k));
};

/** The single accept or reject decision for the measures bundle. */
export const chosenMeasures = contentReader('measures', measuresContent as unknown as MeasuresBundle, isMeasures);

/** The tape parts, in content order. Call it where it is used, not at module level. */
export const getMeasures: () => readonly MeasureDef[] = perLoad(() =>
  chosenMeasures().measures.map((m) => ({ key: `${m.key}_cm` as MeasureKey, label: m.label, show: m.show })),
);

// Messages from the prototype's Progress screen.
export const WEIGHT_HINT = 'Weigh in each morning before eating. Day-to-day swings of a kilo are normal; the weekly direction is what counts.';
export const WEIGHT_BAD = (unit: WeightUnit = 'kg'): string => `Enter your weight in ${unit}, like ${unit === 'lb' ? '180.2' : '81.6'}`;
export const MEASURE_NONE = 'Enter at least one measurement in cm.';
export const HOW_TO_MEASURE = 'Measure in the morning before eating, relaxed and not sucking in. Waist: around the navel. Neck: just below the Adam’s apple. Keep the tape level and snug, not tight. Every 1–2 weeks is plenty.';
/** Added to HOW_TO_MEASURE only where the Hips field shows. */
export const HOW_TO_MEASURE_HIPS = 'Hips: the widest point.';
export const BF_HINT = (hips: boolean): string =>
  `From the US Navy formula using your waist, neck${hips ? ', hips' : ''} and height. It’s usually within a few percent; the trend matters more than the number.`;
export const BF_MISSING = (hips: boolean): string => `Add waist and neck${hips ? ' and hips' : ''} for a body-fat estimate.`;
export const BF_NO_PROFILE = 'Run setup (Targets tab) and add waist and neck for a body-fat estimate.';
export const STEPS_BAD = 'Enter steps as a whole number, like 8000.';
export const SLEEP_BAD = 'Enter hours slept, like 7.5.';
export const TREND_NONE = 'Log a few weigh-ins to see your trend line here.';
export const WAIST_TREND_NONE = 'Log a few waist measurements to see your trend line here.';
export const RECENT_WEIGH_INS_TITLE = 'Recent weigh-ins';
export const SCALE_JUMP_TITLE = (amount: string, unit: WeightUnit = 'kg'): string => `The scale went up ${amount} ${unit}`;
export const SCALE_JUMP_BODY = 'That’s almost certainly water, not fat. Your weekly average is what counts.';

// Chart range control and table alternative (#1351 A1).
export const RANGE_LABEL: Readonly<Record<SeriesRange, string>> = { '4w': '4 weeks', '12w': '12 weeks', all: 'All' };
export const RANGE_NO_DATA = (range: SeriesRange): string => `${RANGE_LABEL[range]}: not enough data`;
export const RANGE_OFF_LABEL = (range: SeriesRange): string => `${RANGE_LABEL[range]}, not enough data`;
export const RANGE_GROUP = (noun: string): string => `${noun} range`;
export const CHART_TARGET = (value: string, unit: string): string => `Target ${value} ${unit}`;
export const TABLE_SHOW = 'Show as table';
export const TABLE_HIDE = 'Hide table';
export const TABLE_SHOW_ALL = 'Show all';
export const TABLE_SHOW_RECENT = (n: number): string => `Show last ${n}`;
export const TABLE_DATE = 'Date';
export const TABLE_LABEL = (noun: string): string => `${noun} values by date`;
export const TREND_SUMMARY = (noun: string, first: number, last: number, unit: string): string => `${noun} from ${first} to ${last} ${unit}`;

// Weekly check-in, burn card and habits (prototype `renderCheckin`, `consistencyHtml`).
export const CHECKIN_TITLE = 'Weekly check-in';
export const CHECKIN_NEEDS_SETUP = 'Run setup (Targets tab) to see your weekly check-in.';
export const WEIGHT_WEEK_NONE = 'Weight: log at least 3 weigh-ins a week to see your weekly trend.';
export const BURN_TITLE = 'Calorie burn from your real data';
export const BURN_HOW = 'If you eat about the same each day and your weight trend changes, the difference shows your real burn: about 7,700 kcal equals 1 kg of body weight. This is usually more accurate than any formula or fitness tracker. It’s smoothed week to week so one odd week doesn’t swing your targets.';
/** The same note for an lb user: it uses core's `KCAL_PER_LB` (3,500) in place of the kg figure. */
export const BURN_HOW_LB = BURN_HOW.replace(`about ${KCAL_PER_KG.toLocaleString('en-US')} kcal equals 1 kg`, `about ${KCAL_PER_LB.toLocaleString('en-US')} kcal equals 1 lb`);
export const NOT_NOW = 'Not now';
export const STOP_SUGGESTING = 'Stop suggesting this';
export const KEEP_TARGETS = 'Keep current targets';
export const HABIT_MESSAGE = {
  streak: (weeks: number, goal: number): string => `${weeks} weeks in a row with ${goal}+ sessions. That’s how habits form.`,
  missed: 'Missed a few days? No problem. Pick up with your next meal or session; one week never undoes progress.',
  steady: 'Aim for most days, not perfect days. Consistency over weeks is what counts.',
} as const;
export const SETTINGS_UNREADABLE = 'Couldn’t read your saved settings, so changes are not saved. Restart the app to try again.';

// "Seven days to <date>", the last block of prototype `renderProgress`.
export const WEEK_TITLE = (date: string): string => `Seven days to ${date}`;
export const WEEK_CURRENT = 'The last 7 days up to today, whichever day you are viewing.';
export const WEEK_LOADING = 'Loading…';
export const WEEK_TRAINED = 'trained';
export const WEEK_NOT_LOGGED = 'not logged';
export const WEEK_AVG_KCAL = 'avg kcal';
export const WEEK_AVG_PROTEIN = 'avg protein';
export const WEEK_SESSIONS = 'sessions';
export const WEEK_TARGET_HINT = 'The thin vertical line on each bar is your calorie target.';

// Rapid-loss card (prototype `calorieCard`).
export const RAPID_TITLE = 'Weight is dropping fast';
export const RAPID_BODY = (drop: number, twoWeeks: boolean, stalls: number, unit: WeightUnit = 'kg'): string =>
  `Your weekly average fell about ${drop} ${unit}${twoWeeks ? ', faster than 1% of your bodyweight a week for 2 weeks running' : `, and ${stalls} lifts have stalled`}. Losing faster than about 1% a week makes it harder to keep muscle. Adding about ${RAPID_LOSS_KCAL} kcal a day helps protect muscle.`;
