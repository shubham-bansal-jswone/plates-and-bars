import type { CandidateWhy } from '@plate-and-bar/core';
import labels from '../../../content/labels.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { getLibrary, jointLabel as libJointLabel, muscleLabel } from '../src/library/exercises';
import { chosenLabels, getLabels, MUSCLE_CODES, muscleName } from '../src/workout/copy';
import { jointLabel, reasonText } from '../src/workout/reasons';
import { ruleText, ruleWhat } from '../src/workout/rulesCopy';
import { openDb } from './sync-helpers';

// A spy on the validator the labels module hands to `contentReader`: counts every run of it, by bundle name.
const mockRuns: string[] = [];
jest.mock('../src/content/reader', () => {
  const actual = jest.requireActual('../src/content/reader');
  return { ...actual, contentReader: (n: string, shipped: unknown, valid: (v: unknown) => boolean) => actual.contentReader(n, shipped, (x: unknown) => { mockRuns.push(n); return valid(x); }) };
});

const blankVectors = require('../../../packages/api/test-vectors/blank-text.json') as { must_fail: string[]; must_pass: string[] };
const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shipped = labels as unknown as Obj;
const why = (o: Partial<CandidateWhy>): CandidateWhy => ({ muscles: ['chest'], sameMovement: false, sparesJoint: null, easierOnJoints: false, easierToLearn: false, doneBefore: false, ...o });

async function store(db: ContentDb, value: unknown): Promise<void> {
  await putStored(db, { name: 'labels', sha256: 'x', schema_version: BUNDLED.labels!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
async function launch(stored: unknown = undefined): Promise<void> {
  const db = await openDb();
  if (stored !== undefined) await store(db, stored);
  await loadContent(db);
}
const edited = (mutate: (b: Obj) => void): Obj => {
  const b = clone(shipped);
  b.muscles.chest = 'pecs';
  b.joints.knee = 'knee joint';
  b.families.bench = 'bench presses';
  b.patterns['h-press'] = 'pressing';
  b.replacement_reasons.works = 'targets your {muscles}';
  mutate(b);
  return b;
};
/** Everything one edited label changes, read through every reader of the bundle. */
const readers = () => ({
  muscle: muscleName('chest'),
  lib: muscleLabel('chest'),
  libJoint: libJointLabel('knee'),
  joint: jointLabel('knee'),
  family: ruleWhat({ scope: 'family', key: 'bench' }),
  pattern: ruleWhat({ scope: 'pattern', key: 'h-press' }),
  reason: reasonText(why({})),
  movement: getLibrary().find((e) => e.name === 'Barbell Bench Press')!.movement,
  libFamily: getLibrary().find((e) => e.name === 'Barbell Bench Press')!.family,
});
const SHIPPED_READ = {
  muscle: 'chest', lib: 'Chest', libJoint: 'knee', joint: 'knee',
  family: 'All bench press variations', pattern: 'All chest pressing', reason: 'Works your chest',
  movement: 'chest pressing', libFamily: 'bench press variations',
};

describe('labels through the content store', () => {
  it('uses the shipped copy when nothing is stored, same reference every call', async () => {
    await launch();
    expect(getLabels()).toBe(labels);
    expect(getLabels()).toBe(getLabels());
    expect(chosenLabels()).toBe(labels);
    expect(readers()).toEqual(SHIPPED_READ);
  });

  it('a valid newer copy is used by every reader, and only at the next load', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getLabels();
    await store(db, edited(() => undefined));
    expect(getLabels()).toBe(before);
    expect(readers()).toEqual(SHIPPED_READ);
    await loadContent(db);
    const after = getLabels();
    expect(after).not.toBe(before);
    expect(getLabels()).toBe(after);
    expect(readers()).toEqual({
      muscle: 'pecs', lib: 'Pecs', libJoint: 'knee joint', joint: 'knee joint',
      family: 'All bench presses', pattern: 'All pressing', reason: 'Targets your pecs',
      movement: 'pressing', libFamily: 'bench presses',
    });
    expect(ruleText({ scope: 'family', key: 'bench', reason: 'pain', until: null })).toBe('All bench presses (pain), permanent');
  });

  it('additions are allowed (a new family, joint and muscle label)', async () => {
    await launch(edited((b) => { b.families.newfam = 'new things'; b.joints.neck = 'neck'; b.muscles.neck = 'neck'; }));
    expect(ruleWhat({ scope: 'family', key: 'newfam' })).toBe('All new things');
    expect(jointLabel('neck')).toBe('neck');
  });

  const cases: [string, (b: Obj) => void][] = [
    ...blankVectors.must_fail.flatMap((t): [string, (b: Obj) => void][] => [
      [`muscle label ${JSON.stringify(t)}`, (b) => { b.muscles.abs = t; }],
      [`muscle key ${JSON.stringify(t)}`, (b) => { b.muscles[t] = 'unique blank-key label'; }],
    ]),
    ['muscles missing', (b) => { delete b.muscles; }],
    ['muscles a list', (b) => { b.muscles = []; }],
    ['a contract muscle without a label', (b) => { delete b.muscles['lower-back']; }],
    ['muscle label empty', (b) => { b.muscles.abs = ''; }],
    ['muscle label number', (b) => { b.muscles.abs = 3; }],
    ['muscle label 5000 characters', (b) => { b.muscles.abs = 'x'.repeat(5000); }],
    ['muscle key empty', (b) => { b.muscles[''] = 'x'; }],
    ['201 muscle keys with distinct labels (the key limit rejects)', (b) => { for (let i = 0; i < 186; i++) b.muscles[`m${i}`] = `label ${i}`; }],
    ['muscle key 61 characters', (b) => { b.muscles['k'.repeat(61)] = 'x'; }],
    ['joint key 61 characters', (b) => { b.joints['k'.repeat(61)] = 'x'; }],
    ['family key 61 characters', (b) => { b.families['k'.repeat(61)] = 'x'; }],
    ['pattern key 61 characters', (b) => { b.patterns['k'.repeat(61)] = 'x'; }],
    ...['muscles', 'joints', 'families', 'patterns'].map((g): [string, (b: Obj) => void] => [`${g} key whitespace only`, (b) => { b[g][' '] = 'x'; }]),
    ['muscle label whitespace only', (b) => { b.muscles.abs = '   '; }],
    ['joint label whitespace only', (b) => { b.joints.knee = ' '; }],
    ['family label whitespace only (renders "All    ")', (b) => { b.families.bench = '   '; }],
    ['pattern label whitespace only', (b) => { b.patterns['h-press'] = ' '; }],
    ['reason text whitespace only', (b) => { b.replacement_reasons.same_movement = ' '; }],
    ['two muscles with the same label', (b) => { b.muscles.abs = b.muscles.chest; }],
    ['two families with the same label', (b) => { b.families.bench = b.families.pushup; }],
    ['two joints with the same label', (b) => { b.joints.knee = b.joints.hip; }],
    ['two patterns with the same label', (b) => { b.patterns['h-press'] = b.patterns['v-press']; }],
    ['works with two {muscles}', (b) => { b.replacement_reasons.works = 'works your {muscles} and {muscles}'; }],
    ['works with a stray {joint}', (b) => { b.replacement_reasons.works = 'works your {muscles} {joint}'; }],
    ['works with another {token}', (b) => { b.replacement_reasons.works = 'works your {muscles} {other}'; }],
    ['spares_joint with two {joint}', (b) => { b.replacement_reasons.spares_joint = '{joint} {joint}'; }],
    ['spares_joint with a stray {muscles}', (b) => { b.replacement_reasons.spares_joint = 'spares the {joint} {muscles}'; }],
    ['same_movement with {muscles}', (b) => { b.replacement_reasons.same_movement = '{muscles}'; }],
    ['easier_on_joints with {joint}', (b) => { b.replacement_reasons.easier_on_joints = 'easier on the {joint}'; }],
    ['done_before with a stray brace', (b) => { b.replacement_reasons.done_before = 'you did it {'; }],
    ['easier_to_learn with a closing brace', (b) => { b.replacement_reasons.easier_to_learn = 'easier }'; }],
    ...['toString', 'constructor', 'hasOwnProperty', '__proto__'].flatMap((p): [string, (b: Obj) => void][] => ['muscles', 'joints', 'families', 'patterns'].map((g) => [`${g} key ${p}`, (b) => { Object.defineProperty(b[g], p, { value: 'x', enumerable: true, writable: true, configurable: true }); }]),
    ),
    ['joints missing', (b) => { delete b.joints; }],
    ['a shipped joint missing', (b) => { delete b.joints.knee; }],
    ['joint label empty', (b) => { b.joints.knee = ''; }],
    ['joint label number', (b) => { b.joints.knee = 1; }],
    ['families missing', (b) => { delete b.families; }],
    ['a shipped family missing (a rule would fall back to "All balance")', (b) => { delete b.families.balance; }],
    ['family label empty', (b) => { b.families.bench = ''; }],
    ['family label 5000 characters', (b) => { b.families.bench = 'x'.repeat(5000); }],
    ['patterns missing', (b) => { delete b.patterns; }],
    ['a shipped pattern missing', (b) => { delete b.patterns['h-press']; }],
    ['pattern label number', (b) => { b.patterns['h-press'] = 2; }],
    ['replacement_reasons missing', (b) => { delete b.replacement_reasons; }],
    ...['works', 'same_movement', 'spares_joint', 'easier_on_joints', 'easier_to_learn', 'done_before'].flatMap((k): [string, (b: Obj) => void][] => [
      [`reason ${k} missing`, (b) => { delete b.replacement_reasons[k]; }],
      [`reason ${k} empty`, (b) => { b.replacement_reasons[k] = ''; }],
      [`reason ${k} number`, (b) => { b.replacement_reasons[k] = 1; }],
      [`reason ${k} 5000 characters`, (b) => { b.replacement_reasons[k] = `{muscles} {joint}${'x'.repeat(5000)}`; }],
    ]),
    ['works without the {muscles} place', (b) => { b.replacement_reasons.works = 'works your muscles'; }],
    ['spares_joint without the {joint} place', (b) => { b.replacement_reasons.spares_joint = 'spares the joint'; }],
  ];

  it.each(cases)('%s rejects the whole copy; every reader keeps the shipped one', async (_n, mutate) => {
    await launch(edited(mutate));
    expect(getLabels()).toBe(labels);
    expect(readers()).toEqual(SHIPPED_READ);
  });

  it.each([[null], [[]], ['text'], [{}], [{ muscles: {} }]])('rejects %j', async (value) => {
    await launch(value);
    expect(getLabels()).toBe(labels);
  });

  it('accepts keys of exactly 60 characters and reasons with their one place each', async () => {
    await launch(edited((b) => { b.families['k'.repeat(60)] = 'long key family'; b.replacement_reasons.works = '{muscles}, a good one'; }));
    expect(ruleWhat({ scope: 'family', key: 'k'.repeat(60) })).toBe('All long key family');
    expect(reasonText(why({}))).toBe('Pecs, a good one');
  });

  it('keys such as constructor and toString read back as the key itself, in every reader, shipped or stored', async () => {
    for (const stored of [undefined, edited(() => undefined)]) {
      await launch(stored);
      for (const k of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
        expect(muscleName(k)).toBe(k);
        expect(jointLabel(k)).toBe(k);
        expect(libJointLabel(k)).toBe(k);
        expect(muscleLabel(k)).toBe(k.charAt(0).toUpperCase() + k.slice(1));
        expect(ruleWhat({ scope: 'joint', key: k })).toBe(`Anything that loads the ${k}`);
        expect(ruleWhat({ scope: 'family', key: k })).toBe(`All ${k}`);
        expect(ruleWhat({ scope: 'pattern', key: k })).toBe(`All ${k}`);
        expect(reasonText(why({ muscles: [k], sparesJoint: k }))).toBe(`${stored ? 'Targets' : 'Works'} your ${k}, doesn’t load the ${k}`);
      }
    }
  });

  it('accepts exactly 200 keys with distinct labels', async () => {
    await launch(edited((b) => { for (let i = 0; i < 185; i++) b.muscles[`m${i}`] = `label ${i}`; }));
    expect(muscleName('m184')).toBe('label 184');
  });

  it('accepts labels of exactly 200 characters and rejects 201', async () => {
    await launch(edited((b) => { b.muscles.abs = 'x'.repeat(200); }));
    expect(muscleName('abs')).toBe('x'.repeat(200));
    await launch(edited((b) => { b.muscles.abs = 'x'.repeat(201); }));
    expect(muscleName('abs')).toBe('abs');
  });

  it('the validator runs once per load however often the readers are called', async () => {
    await launch(edited(() => undefined));
    const runs = () => mockRuns.filter((n) => n === 'labels').length;
    const base = runs();
    for (let i = 0; i < 5; i++) { readers(); getLabels(); chosenLabels(); }
    expect(runs() - base).toBe(1);
    await launch(edited(() => undefined));
    readers();
    expect(runs() - base).toBe(2);
  });

  it('the muscle list matches the contract enum and the shipped labels', () => {
    expect([...MUSCLE_CODES].sort()).toEqual(Object.keys(labels.muscles).sort());
    expect(MUSCLE_CODES).toHaveLength(15);
  });
});
