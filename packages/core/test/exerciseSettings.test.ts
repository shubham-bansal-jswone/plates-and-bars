import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { parse } from 'yaml';
import {
  DEFAULT_STEP,
  EXERCISE_OVERRIDES_MAX,
  EXERCISE_SHEET_TYPES,
  EXERCISE_STEP_CHOICES,
  exerciseOverrideEntry,
  exerciseOverridesWouldExceed,
  noLoad,
  type ExType,
  type ExerciseSettingsDraft,
} from '../src/index';
import { prototypeSource, REPO_ROOT, sliceLine, sliceTrimmedLine } from './helpers';

const src = prototypeSource();
const openapi = parse(readFileSync(resolve(REPO_ROOT, 'packages/api/openapi.yaml'), 'utf8')) as {
  components: { schemas: { Settings: { allOf: [unknown, { properties: { exercise_overrides: { maxProperties: number; additionalProperties: { properties: { type: { enum: ExType[] } } } } } }] } } };
};
const overridesSchema = openapi.components.schemas.Settings.allOf[1].properties.exercise_overrides;
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(openapi as object, 'openapi.json');
const validateOverrides = ajv.getSchema('openapi.json#/components/schemas/Settings/allOf/1/properties/exercise_overrides');
if (!validateOverrides) throw new Error('Settings.exercise_overrides schema not found in openapi.yaml');

/** The prototype's `renderExSettings` line that draws the equipment chips. */
const typeLine = sliceTrimmedLine(src, '<div class="field"><span class="lbl">Equipment</span>');
/** The prototype's `renderExSettings` line that draws the step chips (guarded by `noLoad`). */
const stepLine = sliceTrimmedLine(src, '${noLoad(v.type) ? \'\' : `<div class="field"><span class="lbl">Smallest weight jump');

describe('EXERCISE_SHEET_TYPES (#620)', () => {
  it('is the prototype sheet’s equipment list, in its order', () => {
    const m = /\$\{(\[[^\]]+\])\.map\(t => `<button class="chip" data-act="es-type"/.exec(typeLine);
    if (!m) throw new Error('prototype: equipment list not found in renderExSettings');
    expect(EXERCISE_SHEET_TYPES).toEqual(new Function(`return ${m[1]};`)());
  });

  it('is every contract type but other, which is only for exercises the catalogue does not know', () => {
    const contract = overridesSchema.additionalProperties.properties.type.enum;
    expect(contract.filter((t) => !EXERCISE_SHEET_TYPES.includes(t))).toEqual(['other']);
    expect(EXERCISE_SHEET_TYPES.every((t) => contract.includes(t))).toBe(true);
  });

  it('is frozen', () => expect(Object.isFrozen(EXERCISE_SHEET_TYPES)).toBe(true));
});

describe('EXERCISE_STEP_CHOICES (#620)', () => {
  it('is the prototype sheet’s `steps`', () => {
    const line = sliceTrimmedLine(src, 'const steps = [');
    expect(EXERCISE_STEP_CHOICES).toEqual(new Function(`${line}\nreturn steps;`)());
    expect(EXERCISE_STEP_CHOICES).toEqual([1, 1.25, 2, 2.5, 5, 10]);
  });

  it('is hidden for the noLoad types (bodyweight and timed holds), whose default step is 0', () => {
    // The step chips sit behind `noLoad(v.type) ? '' :` in renderExSettings, so core's noLoad says when they show.
    expect(stepLine).toContain('${steps.map(x => `<button class="chip" data-act="es-step"');
    expect(EXERCISE_SHEET_TYPES.filter(noLoad)).toEqual(['bodyweight', 'time']);
    for (const t of EXERCISE_SHEET_TYPES.filter(noLoad)) expect(DEFAULT_STEP[t]).toBe(0);
  });

  it('holds every loaded type’s default step, so a freshly picked type shows a pressed chip', () => {
    for (const t of EXERCISE_SHEET_TYPES.filter((x) => !noLoad(x))) expect(EXERCISE_STEP_CHOICES).toContain(DEFAULT_STEP[t]);
  });

  it('is frozen', () => expect(Object.isFrozen(EXERCISE_STEP_CHOICES)).toBe(true));
});

type ProtoEntry = { type: ExType; step: number; lo: number; hi: number } | undefined;

/** Runs the prototype's `es-save` range check and save, sliced out of `workoutAction`, on the sheet's values. */
const protoSave = new Function(
  'loText',
  'hiText',
  'type',
  'step',
  [
    sliceLine(src, 'const num = v =>'),
    "const $ = sel => ({ value: sel === '#esLo' ? loText : hiText }); const toast = () => {};",
    'const ES = { v:{ type, step } }, S = { settings:{ ex:{} } }, name = "X";',
    sliceTrimmedLine(src, "const lo = Math.round(num($('#esLo').value))"),
    sliceTrimmedLine(src, 'if(!lo || !hi || lo > hi)'),
    sliceTrimmedLine(src, 'S.settings.ex[name] = { type:ES.v.type, step:ES.v.step, lo, hi };'),
    'return S.settings.ex[name];',
  ].join('\n'),
) as (lo: string, hi: string, type: ExType, step: number) => ProtoEntry;

const draft = (lo: string, hi: string, type: ExType = 'barbell', step = 2.5): ExerciseSettingsDraft => ({ type, step, lo, hi });

describe('exerciseOverrideEntry (#620)', () => {
  // Ranges the prototype and core agree on, saved or refused.
  const agree: [string, string][] = [
    ['8', '12'],
    ['6', '10'],
    ['8', '8'],
    ['1', '1'],
    ['1', '100'],
    ['8,5', '12'], // comma decimal, rounds to 9
    ['7.4', '12.5'], // rounds to 7 and 13
    ['0.5', '1'], // 0.5 rounds to 1
    [' 8 ', '12 reps'], // parseFloat reads the leading number
    ['20', '60'],
    ['', '12'], // blank low
    ['8', ''], // blank high
    ['', ''],
    ['   ', '12'], // spaces only read as 0
    ['abc', '12'],
    ['0', '12'],
    ['0.4', '12'], // rounds to 0
    ['12', '8'], // low above high
    ['8', '0'],
    ['8', '-12'],
  ];

  it.each(agree)('matches the prototype’s es-save for low %j, high %j', (lo, hi) => {
    for (const type of EXERCISE_SHEET_TYPES) {
      const step = DEFAULT_STEP[type];
      const p = protoSave(lo, hi, type, step);
      const c = exerciseOverrideEntry(draft(lo, hi, type, step));
      if (p === undefined) expect(c).toEqual({ kind: 'invalid-range' });
      else expect(c).toEqual({ kind: 'ok', entry: { type: p.type, step_kg: p.step, rep_low: p.lo, rep_high: p.hi } });
    }
  });

  it('decided exception (#620, #200): a low below 1 is refused, though the prototype saves it', () => {
    // The prototype's `!lo || !hi || lo > hi` only refuses 0 and low above high, so it saves -3 to 10, and -3 to -1.
    // The contract's rep_low is an integer of at least 1, so core follows the contract and refuses them.
    for (const [lo, hi] of [['-3', '10'], ['-3', '-1'], ['-0.6', '5'], ['-1', '1']] as const) {
      expect(protoSave(lo, hi, 'barbell', 2.5)).toBeDefined();
      expect(exerciseOverrideEntry(draft(lo, hi))).toEqual({ kind: 'invalid-range' });
    }
    expect(protoSave('-3', '10', 'barbell', 2.5)).toEqual({ type: 'barbell', step: 2.5, lo: -3, hi: 10 });
  });

  it('builds the contract entry from a draft', () => {
    expect(exerciseOverrideEntry(draft('6', '10'))).toEqual({ kind: 'ok', entry: { type: 'barbell', step_kg: 2.5, rep_low: 6, rep_high: 10 } });
    expect(exerciseOverrideEntry(draft('8', '12', 'dumbbell', 1.25))).toEqual({ kind: 'ok', entry: { type: 'dumbbell', step_kg: 1.25, rep_low: 8, rep_high: 12 } });
    expect(exerciseOverrideEntry(draft('20', '60', 'time', 0))).toEqual({ kind: 'ok', entry: { type: 'time', step_kg: 0, rep_low: 20, rep_high: 60 } });
  });

  it('keeps other, the type an unknown exercise already has', () => {
    expect(exerciseOverrideEntry(draft('8', '12', 'other', 2.5))).toEqual({ kind: 'ok', entry: { type: 'other', step_kg: 2.5, rep_low: 8, rep_high: 12 } });
  });

  it('rounds to whole reps the prototype’s way (half up)', () => {
    expect(exerciseOverrideEntry(draft('8.5', '11.5'))).toMatchObject({ entry: { rep_low: 9, rep_high: 12 } });
    expect(exerciseOverrideEntry(draft('8.49', '8.5'))).toMatchObject({ entry: { rep_low: 8, rep_high: 9 } });
  });

  it('refuses a range that only crosses after rounding', () => {
    expect(exerciseOverrideEntry(draft('8.5', '8.4'))).toEqual({ kind: 'invalid-range' });
  });

  it('reads text that is not a finite number as 0, so it is refused', () => {
    expect(exerciseOverrideEntry(draft('Infinity', '12'))).toEqual({ kind: 'invalid-range' });
    expect(exerciseOverrideEntry(draft('1e400', '1e400'))).toEqual({ kind: 'invalid-range' });
    expect(exerciseOverrideEntry(draft('NaN', '12'))).toEqual({ kind: 'invalid-range' });
  });

  it('refuses a step below 0 or not a number, which the sheet never offers', () => {
    expect(exerciseOverrideEntry(draft('8', '12', 'barbell', -1))).toEqual({ kind: 'invalid-step' });
    expect(exerciseOverrideEntry(draft('8', '12', 'barbell', Number.NaN))).toEqual({ kind: 'invalid-step' });
    expect(exerciseOverrideEntry(draft('8', '12', 'barbell', Number.POSITIVE_INFINITY))).toEqual({ kind: 'invalid-step' });
  });

  it('checks the range before the step', () => {
    expect(exerciseOverrideEntry(draft('', '', 'barbell', -1))).toEqual({ kind: 'invalid-range' });
  });

  it('every entry it builds is valid contract Settings.exercise_overrides', () => {
    const lows = ['1', '6', '8,5', '0.5', '20'], highs = ['1', '10', '12', '60', '100'];
    for (const type of [...EXERCISE_SHEET_TYPES, 'other' as const])
      for (const step of [...EXERCISE_STEP_CHOICES, 0])
        for (const lo of lows)
          for (const hi of highs) {
            const r = exerciseOverrideEntry(draft(lo, hi, type, step));
            if (r.kind !== 'ok') continue;
            expect(validateOverrides({ 'Barbell Bench Press': r.entry })).toBe(true);
          }
    // What the prototype would save and core refuses is indeed outside the contract.
    expect(validateOverrides({ X: { type: 'barbell', step_kg: 2.5, rep_low: -3, rep_high: 10 } })).toBe(false);
  });
});

describe('EXERCISE_OVERRIDES_MAX and exerciseOverridesWouldExceed (#620)', () => {
  const entry = { type: 'machine', step_kg: 5, rep_low: 8, rep_high: 12 } as const;
  const full = (n: number): Record<string, typeof entry> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`Exercise ${i}`, entry]));

  it('is the contract’s maxProperties for Settings.exercise_overrides', () => {
    expect(EXERCISE_OVERRIDES_MAX).toBe(500);
    expect(overridesSchema.maxProperties).toBe(EXERCISE_OVERRIDES_MAX);
    expect(validateOverrides(full(500))).toBe(true);
    expect(validateOverrides(full(501))).toBe(false);
  });

  it('allows a new name until the list holds 500', () => {
    expect(exerciseOverridesWouldExceed({}, 'Hack Squat')).toBe(false);
    expect(exerciseOverridesWouldExceed(full(499), 'Hack Squat')).toBe(false);
    expect(exerciseOverridesWouldExceed(full(500), 'Hack Squat')).toBe(true);
    expect(exerciseOverridesWouldExceed(full(501), 'Hack Squat')).toBe(true);
  });

  it('always allows replacing an entry the list already has', () => {
    expect(exerciseOverridesWouldExceed(full(500), 'Exercise 0')).toBe(false);
    expect(exerciseOverridesWouldExceed(full(500), 'Exercise 499')).toBe(false);
  });

  it('reads own keys only, so an inherited name such as toString or __proto__ counts as new', () => {
    expect(exerciseOverridesWouldExceed(full(500), 'toString')).toBe(true);
    expect(exerciseOverridesWouldExceed(full(500), '__proto__')).toBe(true);
    const withProto = { ...full(499), ...(JSON.parse('{"__proto__": {"type":"machine","step_kg":5,"rep_low":8,"rep_high":12}}') as object) };
    expect(Object.keys(withProto)).toHaveLength(500);
    expect(exerciseOverridesWouldExceed(withProto, '__proto__')).toBe(false);
  });
});
