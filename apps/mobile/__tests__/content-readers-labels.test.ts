import type { CandidateWhy } from '@plate-and-bar/core';
import labels from '../../../content/labels.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { jointLabel as libJointLabel, muscleLabel } from '../src/library/exercises';
import { chosenLabels, getLabels, MUSCLE_CODES, muscleName } from '../src/workout/copy';
import { jointLabel, reasonText } from '../src/workout/reasons';
import { ruleText, ruleWhat } from '../src/workout/rulesCopy';
import { openDb } from './sync-helpers';

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
});
const SHIPPED_READ = {
  muscle: 'chest', lib: 'Chest', libJoint: 'knee', joint: 'knee',
  family: 'All bench press variations', pattern: 'All chest pressing', reason: 'Works your chest',
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
    });
    expect(ruleText({ scope: 'family', key: 'bench', reason: 'pain', until: null })).toBe('All bench presses (pain), permanent');
  });

  it('additions are allowed (a new family, joint and muscle label)', async () => {
    await launch(edited((b) => { b.families.newfam = 'new things'; b.joints.neck = 'neck'; b.muscles.neck = 'neck'; }));
    expect(ruleWhat({ scope: 'family', key: 'newfam' })).toBe('All new things');
    expect(jointLabel('neck')).toBe('neck');
  });

  const cases: [string, (b: Obj) => void][] = [
    ['muscles missing', (b) => { delete b.muscles; }],
    ['muscles a list', (b) => { b.muscles = []; }],
    ['a contract muscle without a label', (b) => { delete b.muscles['lower-back']; }],
    ['muscle label empty', (b) => { b.muscles.abs = ''; }],
    ['muscle label number', (b) => { b.muscles.abs = 3; }],
    ['muscle label 5000 characters', (b) => { b.muscles.abs = 'x'.repeat(5000); }],
    ['muscle key empty', (b) => { b.muscles[''] = 'x'; }],
    ['too many muscle keys', (b) => { for (let i = 0; i < 300; i++) b.muscles[`m${i}`] = 'x'; }],
    ['joints missing', (b) => { delete b.joints; }],
    ['a shipped joint missing', (b) => { delete b.joints.knee; }],
    ['joint label empty', (b) => { b.joints.knee = ''; }],
    ['joint label number', (b) => { b.joints.knee = 1; }],
    ['families missing', (b) => { delete b.families; }],
    ['a shipped family missing (reads "All undefined")', (b) => { delete b.families.balance; }],
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

  it('accepts labels of exactly 200 characters and rejects 201', async () => {
    await launch(edited((b) => { b.muscles.abs = 'x'.repeat(200); }));
    expect(muscleName('abs')).toBe('x'.repeat(200));
    await launch(edited((b) => { b.muscles.abs = 'x'.repeat(201); }));
    expect(muscleName('abs')).toBe('abs');
  });

  it('the muscle list matches the contract enum and the shipped labels', () => {
    expect([...MUSCLE_CODES].sort()).toEqual(Object.keys(labels.muscles).sort());
    expect(MUSCLE_CODES).toHaveLength(15);
  });
});
