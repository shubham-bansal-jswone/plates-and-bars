import measures from '../../../content/measures.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { chosenMeasures, getMeasures } from '../src/progress/copy';
import { openDb } from './sync-helpers';

const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shipped = measures as unknown as Obj;
const edit = (mutate: (b: Obj) => void): Obj => { const b = clone(shipped); mutate(b); return b; };

async function store(db: ContentDb, value: unknown): Promise<void> {
  await putStored(db, { name: 'measures', sha256: 'x', schema_version: BUNDLED['measures']!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
async function launch(stored?: unknown): Promise<void> {
  const db = await openDb();
  if (stored !== undefined) await store(db, stored);
  await loadContent(db);
}
const labels = () => getMeasures().map((m) => m.label);
const shippedLabels = (shipped.measures as Obj[]).map((m) => m.label);

describe('measures through the content store', () => {
  it('uses the shipped copy when nothing is stored, in order, with _cm keys and the hips rule', async () => {
    await launch();
    expect(labels()).toEqual(shippedLabels);
    expect(getMeasures().map((m) => m.key)).toEqual(['waist_cm', 'neck_cm', 'chest_cm', 'arm_cm', 'thigh_cm', 'hips_cm']);
    expect(getMeasures()[0]!.show).toBe('always');
    expect(getMeasures()[5]!.show).toEqual({ sex: 'female', or_entered_that_day: true });
    expect(getMeasures()).toBe(getMeasures());
    expect(chosenMeasures()).toBe(measures);
  });

  it('uses a valid newer copy (label edits, a changed rule, reorder) only at the next load', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getMeasures();
    await store(db, edit((b) => { b.measures[0].label = 'Waist edited'; b.measures[5].show = 'always'; b.measures.reverse(); }));
    expect(getMeasures()).toBe(before);
    expect(labels()).toEqual(shippedLabels);
    await loadContent(db);
    expect(labels()).toContain('Waist edited');
    expect(getMeasures()[0]!.key).toBe('hips_cm');
    expect(getMeasures()[0]!.show).toBe('always');
    expect(chosenMeasures().measures[0]!.key).toBe('hips');
  });

  const cases: [string, (b: Obj) => void][] = [
    ['unit not cm', (b) => { b.unit = 'in'; }],
    ['unit missing', (b) => { delete b.unit; }],
    ['measures not a list', (b) => { b.measures = 'x'; }],
    ['measures missing', (b) => { delete b.measures; }],
    ['empty list', (b) => { b.measures = []; }],
    ['a row that is not an object', (b) => { b.measures[1] = 'neck'; }],
    ['a row that is null', (b) => { b.measures[1] = null; }],
    ['unknown key', (b) => { b.measures[1].key = 'calf'; }],
    ['key with _cm suffix', (b) => { b.measures[1].key = 'neck_cm'; }],
    ['key number', (b) => { b.measures[1].key = 5; }],
    ['key missing', (b) => { delete b.measures[1].key; }],
    ['duplicate key', (b) => { b.measures[1].key = 'waist'; }],
    ['shipped part removed (hips)', (b) => { b.measures.pop(); }],
    ['shipped part removed (waist)', (b) => { b.measures.shift(); }],
    ['empty label', (b) => { b.measures[0].label = ''; }],
    ['label 5000 characters', (b) => { b.measures[0].label = 'x'.repeat(5000); }],
    ['label 201 characters', (b) => { b.measures[0].label = 'x'.repeat(201); }],
    ['label number', (b) => { b.measures[0].label = 5; }],
    ['label missing', (b) => { delete b.measures[0].label; }],
    ['show missing', (b) => { delete b.measures[0].show; }],
    ['show unknown string', (b) => { b.measures[0].show = 'sometimes'; }],
    ['show null', (b) => { b.measures[0].show = null; }],
    ['show sex unknown', (b) => { b.measures[5].show.sex = 'other'; }],
    ['show sex missing', (b) => { delete b.measures[5].show.sex; }],
    ['show or_entered_that_day string', (b) => { b.measures[5].show.or_entered_that_day = 'yes'; }],
    ['show or_entered_that_day missing', (b) => { delete b.measures[5].show.or_entered_that_day; }],
  ];
  it.each(cases)('rejects the whole copy: %s', async (_n, mutate) => {
    await launch(edit((b) => { b.measures[0].label = 'Server label'; mutate(b); }));
    expect(labels()).toEqual(shippedLabels);
    expect(chosenMeasures()).toBe(measures);
  });

  it('accepts a copy with the same parts and a valid male rule (control for the rejections)', async () => {
    await launch(edit((b) => { b.measures[5].show.sex = 'male'; b.measures[0].label = 'x'.repeat(200); }));
    expect(getMeasures()[5]!.show).toEqual({ sex: 'male', or_entered_that_day: true });
    expect(labels()[0]).toHaveLength(200);
  });

  it('rejects a body that is not an object', async () => {
    await launch([1, 2]);
    expect(chosenMeasures()).toBe(measures);
    await launch('x');
    expect(chosenMeasures()).toBe(measures);
  });

  it('chosenMeasures and getMeasures agree on accept and reject', async () => {
    await launch(edit((b) => { b.measures[0].label = 'Agreed'; }));
    expect(chosenMeasures().measures[0]!.label).toBe('Agreed');
    expect(labels()[0]).toBe('Agreed');
    await launch(edit((b) => { b.measures[0].label = ''; }));
    expect(chosenMeasures().measures[0]!.label).toBe(shippedLabels[0]);
    expect(labels()[0]).toBe(shippedLabels[0]);
  });
});
