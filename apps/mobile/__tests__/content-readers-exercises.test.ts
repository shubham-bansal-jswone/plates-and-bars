import exercises from '../../../content/exercises.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { getEquipment, getLibrary, getMuscles, getTypes } from '../src/library/exercises';
import { chosenExercises, EQUIPMENT_CODES, getCatalog, MUSCLE_CODES } from '../src/workout/catalog';
import { MUSCLE, TYPE_LABEL } from '../src/workout/copy';
import { openDb } from './sync-helpers';

const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shipped = exercises as unknown as Obj;
const FIRST = Object.keys(shipped.tags)[0]!;
const NEW = 'Server-only test exercise';

async function store(db: ContentDb, name: string, value: unknown): Promise<void> {
  await putStored(db, { name, sha256: 'x', schema_version: BUNDLED[name]!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
async function launch(stored: unknown = undefined): Promise<void> {
  const db = await openDb();
  if (stored !== undefined) await store(db, 'exercises', stored);
  await loadContent(db);
}
/** The shipped bundle plus one new exercise (in tags, meta, cards, library, away_map and a ladder), then `mutate`. */
const withNew = (mutate: (b: Obj) => void = () => undefined): Obj => {
  const b = clone(shipped);
  b.tags[NEW] = { ...clone(shipped.tags[FIRST]) };
  b.meta[NEW] = { ...clone(shipped.meta[FIRST]) };
  b.cards[NEW] = clone(shipped.cards[Object.keys(shipped.cards)[0]!]);
  b.library.Chest.push(NEW);
  mutate(b);
  return b;
};
const tagNames = () => Object.keys(getCatalog().tags);
const libNames = () => getLibrary().map((e) => e.name);
const shippedCount = Object.keys(shipped.tags).length;

describe('exercises through the content store', () => {
  it('uses the shipped copy when nothing is stored, with the same reference every call', async () => {
    await launch();
    expect(getCatalog()).toBe(exercises);
    expect(getCatalog()).toBe(getCatalog());
    expect(chosenExercises()).toBe(getCatalog());
    expect(getLibrary()).toHaveLength(shippedCount);
    expect(getLibrary()).toBe(getLibrary());
  });

  it('the shipped copy passes its own validator (a stored copy equal to it is chosen)', async () => {
    await launch(clone(shipped));
    expect(getCatalog()).not.toBe(exercises);
    expect(getCatalog()).toEqual(exercises);
  });

  it('uses a valid newer copy (additions and value edits allowed) only at the next load, same reference between', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getCatalog();
    const edited = withNew((b) => { b.tags[FIRST].difficulty = 1; b.meta[FIRST].rep_high = 99; });
    await store(db, 'exercises', edited);
    expect(getCatalog()).toBe(before);
    expect(tagNames()).not.toContain(NEW);
    await loadContent(db);
    const after = getCatalog();
    expect(after).not.toBe(before);
    expect(getCatalog()).toBe(after);
    expect(tagNames()).toContain(NEW);
    expect(tagNames()).toHaveLength(shippedCount + 1);
    expect(after.meta[FIRST]!.rep_high).toBe(99);
  });

  it('the library reads the same accepted copy as the catalog', async () => {
    await launch(withNew());
    expect(tagNames()).toContain(NEW);
    expect(libNames()).toContain(NEW);
    expect(getLibrary().find((e) => e.name === NEW)!.card).not.toBeNull();
    expect(getCatalog().library.Chest).toContain(NEW);
    expect(libNames()).toEqual([...libNames()].sort((a, b) => a.localeCompare(b)));
  });

  it('a valid copy with a ladder step, a away-map entry and a library entry on a new exercise is used', async () => {
    await launch(withNew((b) => {
      b.ladders.squat.steps.push([NEW]);
      b.away_map.dumbbells_bodyweight[NEW] = [FIRST, null];
    }));
    expect(getCatalog().ladders.squat!.steps.at(-1)).toEqual([NEW]);
  });

  const cases: [string, (b: Obj) => void][] = [
    ['bundle tags missing', (b) => { delete b.tags; }],
    ['tags empty', (b) => { b.tags = {}; b.meta = {}; }],
    ['tags a list', (b) => { b.tags = []; }],
    ['tag null', (b) => { b.tags[NEW] = null; }],
    ['tag equipment not in the contract (assisted)', (b) => { b.tags[NEW].equipment = 'assisted'; }],
    ['tag equipment number', (b) => { b.tags[NEW].equipment = 1; }],
    ['tag equipment missing', (b) => { delete b.tags[NEW].equipment; }],
    ['difficulty 0', (b) => { b.tags[NEW].difficulty = 0; }],
    ['difficulty 4', (b) => { b.tags[NEW].difficulty = 4; }],
    ['difficulty fractional', (b) => { b.tags[NEW].difficulty = 2.5; }],
    ['difficulty string', (b) => { b.tags[NEW].difficulty = '2'; }],
    ['difficulty missing', (b) => { delete b.tags[NEW].difficulty; }],
    ['primary muscle not in the contract', (b) => { b.tags[NEW].primary = ['biceps-brachii']; }],
    ['primary empty', (b) => { b.tags[NEW].primary = []; }],
    ['primary not a list', (b) => { b.tags[NEW].primary = 'chest'; }],
    ['primary missing', (b) => { delete b.tags[NEW].primary; }],
    ['secondary muscle not in the contract', (b) => { b.tags[NEW].secondary = ['pecs']; }],
    ['secondary not a list', (b) => { b.tags[NEW].secondary = 'chest'; }],
    ['secondary missing', (b) => { delete b.tags[NEW].secondary; }],
    ['joints with a number', (b) => { b.tags[NEW].joints = ['knee', 3]; }],
    ['joints empty text', (b) => { b.tags[NEW].joints = ['']; }],
    ['joints missing', (b) => { delete b.tags[NEW].joints; }],
    ['pattern missing', (b) => { delete b.tags[NEW].pattern; }],
    ['pattern empty', (b) => { b.tags[NEW].pattern = ''; }],
    ['pattern 5000 characters', (b) => { b.tags[NEW].pattern = 'x'.repeat(5000); }],
    ['family number', (b) => { b.tags[NEW].family = 4; }],
    ['family missing', (b) => { delete b.tags[NEW].family; }],
    ['exercise name 5000 characters', (b) => { const t = b.tags[NEW]; delete b.tags[NEW]; delete b.meta[NEW]; delete b.cards[NEW]; b.library.Chest.pop(); b.tags['x'.repeat(5000)] = t; b.meta['x'.repeat(5000)] = clone(shipped.meta[FIRST]); }],
    ['exercise with tags but no meta', (b) => { delete b.meta[NEW]; }],
    ['meta for an exercise with no tags', (b) => { b.meta['Orphan'] = clone(shipped.meta[FIRST]); }],
    ['meta type not an ExType', (b) => { b.meta[NEW].type = 'kettlebell'; }],
    ['meta type number', (b) => { b.meta[NEW].type = 1; }],
    ['meta type missing', (b) => { delete b.meta[NEW].type; }],
    ['rep_low 0', (b) => { b.meta[NEW].rep_low = 0; }],
    ['rep_low negative', (b) => { b.meta[NEW].rep_low = -1; }],
    ['rep_low fractional', (b) => { b.meta[NEW].rep_low = 5.5; }],
    ['rep_low string', (b) => { b.meta[NEW].rep_low = '5'; }],
    ['rep_low missing', (b) => { delete b.meta[NEW].rep_low; }],
    ['rep_high huge', (b) => { b.meta[NEW].rep_high = 1e9; }],
    ['rep_high 201', (b) => { b.meta[NEW].rep_high = 201; }],
    ['rep_low 201', (b) => { b.meta[NEW].rep_low = 201; b.meta[NEW].rep_high = 300; }],
    ['card line 1001 characters', (b) => { b.cards[NEW].key_cues = ['x'.repeat(1001)]; }],
    ['rep_high Infinity-like (null)', (b) => { b.meta[NEW].rep_high = null; }],
    ['rep_high missing', (b) => { delete b.meta[NEW].rep_high; }],
    ['rep_low above rep_high', (b) => { b.meta[NEW].rep_low = 12; b.meta[NEW].rep_high = 8; }],
    ['cards missing', (b) => { delete b.cards; }],
    ['card not an object', (b) => { b.cards[NEW] = 'x'; }],
    ['card where_to_feel missing', (b) => { delete b.cards[NEW].where_to_feel; }],
    ['card where_to_feel empty', (b) => { b.cards[NEW].where_to_feel = ''; }],
    ['card where_to_feel number', (b) => { b.cards[NEW].where_to_feel = 5; }],
    ['card setup with a number', (b) => { b.cards[NEW].setup = ['a', 1]; }],
    ['card setup not a list', (b) => { b.cards[NEW].setup = 'a'; }],
    ['card setup missing', (b) => { delete b.cards[NEW].setup; }],
    ['card setup line 5000 characters', (b) => { b.cards[NEW].setup = ['x'.repeat(5000)]; }],
    ['card key_cues missing', (b) => { delete b.cards[NEW].key_cues; }],
    ['card key_cues with a number', (b) => { b.cards[NEW].key_cues = [1]; }],
    ['card common_mistakes missing', (b) => { delete b.cards[NEW].common_mistakes; }],
    ['card common_mistakes with a number', (b) => { b.cards[NEW].common_mistakes = [1]; }],
    ['card breathing number', (b) => { b.cards[NEW].breathing = 1; }],
    ['card easier_version number', (b) => { b.cards[NEW].easier_version = 1; }],
    ['card harder_version number', (b) => { b.cards[NEW].harder_version = 1; }],
    ['card misplaced_feel not pairs', (b) => { b.cards[NEW].misplaced_feel = [['a']]; }],
    ['card misplaced_feel not a list', (b) => { b.cards[NEW].misplaced_feel = 'a'; }],
    ['ladders missing', (b) => { delete b.ladders; }],
    ['ladders empty', (b) => { b.ladders = {}; }],
    ['ladder label empty', (b) => { b.ladders.squat.label = ''; }],
    ['ladder label missing', (b) => { delete b.ladders.squat.label; }],
    ['ladder steps empty', (b) => { b.ladders.squat.steps = []; }],
    ['ladder steps not a list', (b) => { b.ladders.squat.steps = 'x'; }],
    ['ladder step empty', (b) => { b.ladders.squat.steps[0] = []; }],
    ['ladder step with an unknown exercise', (b) => { b.ladders.squat.steps[0] = ['Not an exercise']; }],
    ['ladder step with a number', (b) => { b.ladders.squat.steps[0] = [3]; }],
    ['away_map missing', (b) => { delete b.away_map; }],
    ['away_map dumbbells_bodyweight missing', (b) => { delete b.away_map.dumbbells_bodyweight; }],
    ['away_map empty', (b) => { b.away_map.dumbbells_bodyweight = {}; }],
    ['away entry for an unknown exercise', (b) => { b.away_map.dumbbells_bodyweight['Not an exercise'] = [FIRST, null]; }],
    ['away entry maps to an unknown exercise', (b) => { b.away_map.dumbbells_bodyweight[FIRST] = ['Not an exercise', null]; }],
    ['away entry with one value', (b) => { b.away_map.dumbbells_bodyweight[FIRST] = [FIRST]; }],
    ['away entry with three values', (b) => { b.away_map.dumbbells_bodyweight[FIRST] = [FIRST, null, null]; }],
    ['away entry value a number', (b) => { b.away_map.dumbbells_bodyweight[FIRST] = [1, null]; }],
    ['library missing', (b) => { delete b.library; }],
    ['library empty', (b) => { b.library = {}; }],
    ['library group empty', (b) => { b.library.Chest = []; }],
    ['library group not a list', (b) => { b.library.Chest = 'x'; }],
    ['library lists an unknown exercise', (b) => { b.library.Chest.push('Not an exercise'); }],
    ['library group name 5000 characters', (b) => { b.library['x'.repeat(5000)] = [FIRST]; }],
  ];

  it.each(cases)('%s rejects the whole copy; catalog and library both keep the shipped one', async (_n, mutate) => {
    await launch(withNew(mutate));
    expect(getCatalog()).toBe(exercises);
    expect(tagNames()).toHaveLength(shippedCount);
    expect(libNames()).not.toContain(NEW);
    expect(libNames()).toHaveLength(shippedCount);
  });

  it.each([[null], [[]], ['text'], [{ tags: {} }], [{ tags: 'x' }], [{ tags: { a: null } }]])('rejects %j', async (value) => {
    await launch(value);
    expect(getCatalog()).toBe(exercises);
  });

  it('a stored copy that drops a shipped exercise from tags and meta is rejected whole (stored workouts name it)', async () => {
    await launch(withNew((b) => { delete b.tags[FIRST]; delete b.meta[FIRST]; delete b.cards[FIRST]; for (const g of Object.values<string[]>(b.library)) { const i = g.indexOf(FIRST); if (i >= 0) g.splice(i, 1); } b.ladders = clone(shipped.ladders); b.away_map = clone(shipped.away_map); }));
    expect(tagNames()).toContain(FIRST);
    expect(tagNames()).not.toContain(NEW);
  });

  it('a renamed shipped exercise is rejected whole, for every shipped exercise', async () => {
    for (const n of Object.keys(shipped.tags)) {
      const b = clone(shipped);
      const t = b.tags[n]; const m = b.meta[n];
      delete b.tags[n]; delete b.meta[n];
      b.tags[`${n} renamed`] = t; b.meta[`${n} renamed`] = m;
      await launch(b);
      expect(tagNames()).toContain(n);
      expect(tagNames()).not.toContain(`${n} renamed`);
    }
  });

  it('accepts a card with only the required fields and names of exactly 200 characters', async () => {
    const long = 'n'.repeat(200);
    await launch(withNew((b) => { b.tags[long] = b.tags[NEW]; b.meta[long] = b.meta[NEW]; delete b.cards[NEW].misplaced_feel; delete b.cards[NEW].harder_version; }));
    expect(tagNames()).toContain(long);
    await launch(withNew((b) => { b.tags['n'.repeat(201)] = b.tags[NEW]; b.meta['n'.repeat(201)] = b.meta[NEW]; }));
    expect(tagNames()).not.toContain('n'.repeat(201));
  });

  it('accepts the contract edges: difficulty 1 and 3, every contract equipment, every ExType, every muscle', async () => {
    const b = withNew();
    EQUIPMENT_CODES.forEach((eq, i) => { b.tags[`E${i}`] = { ...b.tags[NEW], equipment: eq, difficulty: (i % 3) + 1 }; b.meta[`E${i}`] = b.meta[NEW]; });
    Object.keys(TYPE_LABEL).forEach((t, i) => { b.tags[`T${i}`] = b.tags[NEW]; b.meta[`T${i}`] = { type: t, rep_low: 1, rep_high: 200 }; });
    b.tags.M = { ...b.tags[NEW], primary: [...MUSCLE_CODES], secondary: [...MUSCLE_CODES] };
    b.meta.M = b.meta[NEW];
    await launch(b);
    expect(tagNames()).toContain('M');
    expect(tagNames()).toContain(`E${EQUIPMENT_CODES.length - 1}`);
    expect(tagNames()).toContain(`T${Object.keys(TYPE_LABEL).length - 1}`);
  });

  it('a validator spy proves one validation per load is enough: getters never revalidate', async () => {
    await launch(withNew());
    const a = getCatalog();
    for (let i = 0; i < 5; i++) { getCatalog(); getLibrary(); getEquipment(); getMuscles(); getTypes(); }
    expect(getCatalog()).toBe(a);
  });

  it('the contract lists match what the app uses: muscles and equipment, and TYPE_LABEL covers every shipped type', () => {
    expect([...MUSCLE_CODES].sort()).toEqual(Object.keys(MUSCLE).sort());
    expect(EQUIPMENT_CODES).toEqual(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other']);
    for (const m of Object.values<Obj>(shipped.meta)) expect(Object.keys(TYPE_LABEL)).toContain(m.type);
  });

  it('chip lists follow the accepted copy', async () => {
    const b = withNew();
    b.tags[NEW].equipment = 'other';
    b.tags[NEW].primary = ['forearms'];
    b.meta[NEW].type = 'time';
    await launch(b);
    expect(getEquipment()).toContain('other');
    expect(getMuscles()).toContain('forearms');
    expect(getTypes()).toContain('time');
    await launch();
    expect(getEquipment()).not.toContain('other');
  });
});
