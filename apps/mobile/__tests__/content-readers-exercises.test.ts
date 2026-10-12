import labels from '../../../content/labels.json';
import exercises from '../../../content/exercises.json';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { getEquipment, getLibrary, getMuscles, getTypes } from '../src/library/exercises';
import { chosenExercises, EQUIPMENT_CODES, getCatalog } from '../src/workout/catalog';
import { MUSCLE_CODES, TYPE_LABEL } from '../src/workout/copy';
import { openDb } from './sync-helpers';

// A spy on the validator the catalog hands to `contentReader`: counts every run of it, by bundle name.
const mockRuns: string[] = [];
jest.mock('../src/content/reader', () => {
  const actual = jest.requireActual('../src/content/reader');
  return { ...actual, contentReader: (n: string, shipped: unknown, valid: (v: unknown) => boolean) => actual.contentReader(n, shipped, (x: unknown) => { mockRuns.push(n); return valid(x); }) };
});

const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shipped = exercises as unknown as Obj;
const FIRST = Object.keys(shipped.tags)[0]!;
const NEW = 'Server-only test exercise';
const names = (eq: string) => Object.keys(shipped.tags).filter((n) => shipped.tags[n].equipment === eq);
const BODYWEIGHT = names('bodyweight')[0]!;
const BARBELL = names('barbell')[0]!;
const DUMBBELL = names('dumbbell')[0]!;
const AWAY_KEY = Object.keys(shipped.away_map.dumbbells_bodyweight)[0]!;
const onLadder = new Set<string>(Object.values<Obj>(shipped.ladders).flatMap((l) => l.steps.flat()));
const [UNLADDERED, UNLADDERED2] = Object.keys(shipped.tags).filter((n) => !onLadder.has(n)) as [string, string];

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
      b.away_map.dumbbells_bodyweight[NEW] = [BODYWEIGHT, null];
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
    ['meta key renamed so tags and meta differ (same size)', (b) => { b.meta['Other name'] = b.meta[NEW]; delete b.meta[NEW]; }],
    ['family empty', (b) => { b.tags[NEW].family = ''; }],
    ['family 61 characters', (b) => { b.tags[NEW].family = 'f'.repeat(61); }],
    ['family whitespace only', (b) => { b.tags[NEW].family = '  '; }],
    ['101 joints', (b) => { b.tags[NEW].joints = Array.from({ length: 101 }, (_, i) => `j${i}`); }],
    ['101 secondary muscles', (b) => { b.tags[NEW].secondary = Array.from({ length: 101 }, () => 'chest'); }],
    ['101 setup lines', (b) => { b.cards[NEW].setup = Array.from({ length: 101 }, () => 'x'); }],
    ['rep_high fractional', (b) => { b.meta[NEW].rep_high = 10.5; }],
    ['meta unknown field', (b) => { b.meta[NEW].tempo = '3-1-1'; }],
    ['card unknown field', (b) => { b.cards[NEW].video = 'x'; }],
    ['card misplaced_feel missing', (b) => { delete b.cards[NEW].misplaced_feel; }],
    ['card misplaced_feel empty', (b) => { b.cards[NEW].misplaced_feel = []; }],
    ['card misplaced_feel with empty texts', (b) => { b.cards[NEW].misplaced_feel = [['', '']]; }],
    ['card misplaced_feel with 5000-character text', (b) => { b.cards[NEW].misplaced_feel = [['a', 'x'.repeat(5000)]]; }],
    ['card setup empty', (b) => { b.cards[NEW].setup = []; }],
    ['card key_cues empty', (b) => { b.cards[NEW].key_cues = []; }],
    ['card common_mistakes empty', (b) => { b.cards[NEW].common_mistakes = []; }],
    ['card common_mistakes empty line', (b) => { b.cards[NEW].common_mistakes = ['']; }],
    ['card common_mistakes whitespace line', (b) => { b.cards[NEW].common_mistakes = ['  ']; }],
    ['card common_mistakes 5000 characters', (b) => { b.cards[NEW].common_mistakes = ['x'.repeat(5000)]; }],
    ['card breathing empty', (b) => { b.cards[NEW].breathing = ''; }],
    ['card breathing 5000 characters', (b) => { b.cards[NEW].breathing = 'x'.repeat(5000); }],
    ['card easier_version 5000 characters', (b) => { b.cards[NEW].easier_version = 'x'.repeat(5000); }],
    ['card harder_version whitespace', (b) => { b.cards[NEW].harder_version = ' '; }],
    ['card where_to_feel whitespace', (b) => { b.cards[NEW].where_to_feel = ' '; }],
    ['exercise name with a trailing space (a second Goblet Squat)', (b) => { b.tags[`${FIRST} `] = clone(b.tags[FIRST]); b.meta[`${FIRST} `] = clone(b.meta[FIRST]); b.cards[`${FIRST} `] = clone(b.cards[FIRST]); }],
    ['exercise name with a leading space', (b) => { b.tags[` ${NEW}`] = b.tags[NEW]; b.meta[` ${NEW}`] = b.meta[NEW]; delete b.tags[NEW]; delete b.meta[NEW]; delete b.cards[NEW]; b.library.Chest.pop(); }],
    ['pattern with a trailing space', (b) => { b.tags[NEW].pattern = 'squat '; }],
    ['joint with a leading space', (b) => { b.tags[NEW].joints = [' knee']; }],
    ['away target with no card (card check on away targets)', (b) => { b.tags[NEW].equipment = 'bodyweight'; delete b.cards[NEW]; b.library.Chest.pop(); b.away_map.dumbbells_bodyweight[AWAY_KEY][1] = NEW; }],
    ['away column 0 target with no card', (b) => { b.tags[NEW].equipment = 'dumbbell'; delete b.cards[NEW]; b.library.Chest.pop(); b.away_map.dumbbells_bodyweight[AWAY_KEY][0] = NEW; }],
    ['exercise name whitespace only', (b) => { b.tags[' '] = b.tags[NEW]; b.meta[' '] = b.meta[NEW]; }],
    ...['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'].flatMap((p): [string, (b: Obj) => void][] => [
      [`pattern ${p}`, (b) => { b.tags[NEW].pattern = p; }],
      [`family ${p}`, (b) => { b.tags[NEW].family = p; }],
      [`joint ${p}`, (b) => { b.tags[NEW].joints = [p]; }],
      [`ladder step with ${p}`, (b) => { b.ladders.squat.steps.push([p]); }],
      [`library group named ${p}`, (b) => { Object.defineProperty(b.library, p, { value: [FIRST], enumerable: true, writable: true, configurable: true }); }],
      [`ladder named ${p}`, (b) => { Object.defineProperty(b.ladders, p, { value: { label: 'x', steps: [[NEW]] }, enumerable: true, writable: true, configurable: true }); }],
    ]),
    ['exercise named toString', (b) => { b.tags.toString = b.tags[NEW]; b.meta.toString = b.meta[NEW]; }],
    ['exercise named constructor', (b) => { b.tags.constructor = b.tags[NEW]; b.meta.constructor = b.meta[NEW]; }],
    ['exercise named __proto__ (an own key from JSON.parse)', (b) => {
      Object.defineProperty(b.tags, '__proto__', { value: b.tags[NEW], enumerable: true, writable: true, configurable: true });
      Object.defineProperty(b.meta, '__proto__', { value: b.meta[NEW], enumerable: true, writable: true, configurable: true });
    }],
    ['card keyed by an Object.prototype name', (b) => { b.cards.valueOf = clone(b.cards[NEW]); }],
    ['an exercise on two ladders', (b) => { b.ladders.extra = { label: 'Extra', steps: [[shipped.ladders.squat.steps[0][0]]] }; }],
    ['an exercise twice in one ladder', (b) => { b.ladders.squat.steps.push([shipped.ladders.squat.steps[0][0]]); }],
    ['a new exercise twice in one step', (b) => { b.ladders.squat.steps.push([NEW, NEW]); }],
    ['a shipped ladder missing', (b) => { delete b.ladders.squat; }],
    ['shipped ladders reordered', (b) => { const e = Object.entries(b.ladders); e.reverse(); b.ladders = Object.fromEntries(e); }],
    ['a shipped ladder with its steps reversed', (b) => { b.ladders.squat.steps.reverse(); }],
    ['a shipped step with a name removed', (b) => { b.ladders.squat.steps[2] = [shipped.ladders.squat.steps[2][1]]; }],
    ['a shipped step with its names reordered', (b) => { b.ladders.squat.steps[2] = [...shipped.ladders.squat.steps[2]].reverse(); }],
    ['a shipped step with a new name before the shipped ones', (b) => { b.ladders.squat.steps[0] = [NEW, ...shipped.ladders.squat.steps[0]]; }],
    ['a shipped ladder with the last step removed', (b) => { b.ladders.squat.steps.pop(); }],
    ['shipped exercises reordered in tags (focusPick breaks ties by it)', (b) => { const t = b.tags; const first = Object.keys(t)[0]!; const v = t[first]; delete t[first]; t[first] = v; }],
    ['a shipped exercise changed to type assisted', (b) => { b.meta[FIRST].type = 'assisted'; }],
    ['a shipped exercise changed to type time', (b) => { b.meta[FIRST].type = 'time'; }],
    ['a shipped exercise changed to type bodyweight', (b) => { b.meta[FIRST].type = 'bodyweight'; }],
    ['a shipped exercise changed to an equipment', (b) => { b.tags[BARBELL].equipment = 'bodyweight'; }],
    ['a shipped exercise changed to equipment other', (b) => { b.tags[BODYWEIGHT].equipment = 'other'; }],
    ['dumbbells column to a barbell exercise', (b) => { b.away_map.dumbbells_bodyweight[AWAY_KEY][0] = BARBELL; }],
    ['dumbbells column to a machine exercise', (b) => { b.away_map.dumbbells_bodyweight[AWAY_KEY][0] = Object.keys(shipped.tags).find((n) => shipped.tags[n].equipment === 'machine'); }],
    ['bodyweight column to a dumbbell exercise', (b) => { b.away_map.dumbbells_bodyweight[AWAY_KEY][1] = DUMBBELL; }],
    ['bodyweight column to a barbell exercise', (b) => { b.away_map.dumbbells_bodyweight[AWAY_KEY][1] = BARBELL; }],
    ['a shipped away entry removed', (b) => { delete b.away_map.dumbbells_bodyweight[AWAY_KEY]; }],
    ['library group with 1001 names', (b) => { b.library.Chest = Array.from({ length: 1001 }, () => FIRST); }],
    ['an exercise a library group lists has no card', (b) => { delete b.cards[NEW]; }],
    ['an exercise an away entry lists has no card', (b) => { delete b.cards[NEW]; b.library.Chest.pop(); b.away_map.dumbbells_bodyweight[NEW] = [null, null]; }],
    ['an exercise a ladder lists has no card', (b) => { delete b.cards[NEW]; b.library.Chest.pop(); b.ladders.squat.steps.push([NEW]); }],
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

  it('accepts an exercise no ladder, away entry or library group uses without a card, and a changed rep range and difficulty on a shipped one', async () => {
    await launch(withNew((b) => { delete b.cards[NEW]; b.library.Chest.pop(); b.meta[FIRST].rep_low = 1; b.tags[FIRST].difficulty = 3; }));
    expect(tagNames()).toContain(NEW);
  });

  it('accepts appended ladder steps, a new ladder, a name added after the shipped ones in a step, and away entries to allowed columns', async () => {
    await launch(withNew((b) => {
      b.ladders.squat.steps[0].push(NEW);
      b.ladders.squat.steps.push([UNLADDERED]);
      b.ladders.fresh = { label: 'Fresh', steps: [[UNLADDERED2]] };
      b.away_map.dumbbells_bodyweight[NEW] = [DUMBBELL, BODYWEIGHT];
    }));
    expect(getCatalog().ladders.squat!.steps.at(-1)).toEqual([UNLADDERED]);
    expect(getCatalog().ladders.squat!.steps[0]).toEqual([...shipped.ladders.squat.steps[0], NEW]);
  });

  it('accepts a 100-item list and a 1000-name library group', async () => {
    await launch(withNew((b) => { b.tags[NEW].joints = Array.from({ length: 100 }, (_, i) => `j${i}`); b.library.Chest = Array.from({ length: 1000 }, () => FIRST); }));
    expect(tagNames()).toContain(NEW);
  });

  it('accepts a card with only the required fields and names of exactly 200 characters', async () => {
    const long = 'n'.repeat(200);
    await launch(withNew((b) => { b.tags[long] = b.tags[NEW]; b.meta[long] = b.meta[NEW]; delete b.cards[NEW].harder_version; delete b.cards[NEW].breathing; }));
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

  it('the validator runs once per load however often every getter is called, and again only after the next load', async () => {
    await launch(withNew());
    const runs = () => mockRuns.filter((n) => n === 'exercises').length;
    const base = runs();
    const a = getCatalog();
    const lib = getLibrary();
    const eq = getEquipment();
    const mu = getMuscles();
    const ty = getTypes();
    for (let i = 0; i < 5; i++) { getCatalog(); getLibrary(); getEquipment(); getMuscles(); getTypes(); chosenExercises(); }
    expect(runs() - base).toBe(1);
    expect(getCatalog()).toBe(a);
    expect(getLibrary()).toBe(lib);
    expect(getEquipment()).toBe(eq);
    expect(getMuscles()).toBe(mu);
    expect(getTypes()).toBe(ty);
    await launch(withNew());
    getCatalog(); getLibrary(); getEquipment();
    expect(runs() - base).toBe(2);
    expect(getEquipment()).not.toBe(eq);
  });

  it('the contract lists match what the app uses: muscles and equipment, and TYPE_LABEL covers every shipped type', () => {
    expect([...MUSCLE_CODES].sort()).toEqual(Object.keys(labels.muscles).sort());
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
