import raw from '../../../content/raw-ingredients.json';
import recipes from '../../../content/recipes.json';
import { getFoodSources, sourceKey } from '../src/about/sources';
import { BUNDLED } from '../src/content/bundled';
import { loadContent } from '../src/content/loader';
import { putStored, type ContentDb } from '../src/content/store';
import { chosenRaw, chosenRecipes, getKatoriG, getLibrary, getPresets, getRawIngredients, getRawNames } from '../src/recipes/content';
import { openDb } from './sync-helpers';

const LATER = '2099-01-01T00:00:00Z';
type Obj = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const shippedRaw = raw as unknown as Obj;
const shippedRecipes = recipes as unknown as Obj;
const UUID = '11111111-2222-4333-8444-555555555555';
const SRC = { code: 'kitchen_test', name: 'Server source', licence: 'CC0', url: null, reference: null };
const rawCount = shippedRaw.ingredients.length as number;

async function store(db: ContentDb, name: string, value: unknown): Promise<void> {
  await putStored(db, { name, sha256: 'x', schema_version: BUNDLED[name]!.schema_version, updated_at: LATER, body: JSON.stringify(value) });
}
async function launch(stored: Record<string, unknown> = {}): Promise<void> {
  const db = await openDb();
  for (const [n, v] of Object.entries(stored)) await store(db, n, v);
  await loadContent(db);
}
const newRaw = (over: Obj = {}): Obj => ({ ...clone(shippedRaw.ingredients[0]), id: UUID, name: 'Server-only test ingredient', ...over });
const rawWith = (mutate: (b: Obj) => void): Obj => { const b = clone(shippedRaw); b.ingredients.push(newRaw()); mutate(b); return b; };
const newRecipe = (kind: 'library' | 'preset', over: Obj = {}): Obj => ({ ...clone(shippedRecipes[kind === 'library' ? 'library' : 'presets'][0]), id: UUID, name: 'Server-only test recipe', ...over });
const recipesWith = (mutate: (b: Obj) => void): Obj => { const b = clone(shippedRecipes); b.library.push(newRecipe('library')); b.presets.push(newRecipe('preset')); mutate(b); return b; };
const rawNames = () => getRawIngredients().map((i) => i.name);
const libNames = () => getLibrary().map((r) => r.name);
const presetNames = () => getPresets().map((r) => r.name);
const shippedKeys = async () => { await launch(); return getFoodSources().map(sourceKey); };

describe('raw ingredients and recipes through the content store', () => {
  it('use the shipped copies when nothing is stored, memoised', async () => {
    await launch();
    expect(getRawIngredients()).toHaveLength(rawCount);
    expect(getLibrary()).toHaveLength(shippedRecipes.library.length);
    expect(getPresets()).toHaveLength(shippedRecipes.presets.length);
    expect(getKatoriG()).toBe(shippedRecipes.katori_g);
    expect(getRawIngredients()).toBe(getRawIngredients());
    expect(getLibrary()).toBe(getLibrary());
    expect(getPresets()).toBe(getPresets());
    expect(getRawNames()).toBe(getRawNames());
    expect(getRawNames()).toEqual(shippedRaw.ingredients.map((i: Obj) => i.name));
  });

  it('use valid newer copies (additions and value edits allowed) only at the next load', async () => {
    const db = await openDb();
    await loadContent(db);
    const before = getRawIngredients();
    const beforeLib = getLibrary();
    await store(db, 'raw-ingredients', rawWith((b) => { b.ingredients[0].per_100g.kcal += 1; }));
    await store(db, 'recipes', recipesWith((b) => { b.katori_g = 160; }));
    expect(getRawIngredients()).toBe(before);
    expect(getLibrary()).toBe(beforeLib);
    expect(getKatoriG()).toBe(shippedRecipes.katori_g);
    expect(rawNames()).not.toContain('Server-only test ingredient');
    await loadContent(db);
    expect(rawNames()).toContain('Server-only test ingredient');
    expect(getRawNames()).toContain('Server-only test ingredient');
    expect(getRawIngredients()).toHaveLength(rawCount + 1);
    expect(getRawIngredients()[0]!.per_100g.kcal).toBe(shippedRaw.ingredients[0].per_100g.kcal + 1);
    expect(libNames()).toContain('Server-only test recipe');
    expect(presetNames()).toContain('Server-only test recipe');
    expect(getKatoriG()).toBe(160);
    expect(getRawIngredients()).toBe(getRawIngredients());
  });

  const rawCases: [string, (r: Obj) => void][] = [
    ['negative kcal', (r) => { r.per_100g.kcal = -1; }],
    ['huge kcal', (r) => { r.per_100g.kcal = 1e300; }],
    ['string kcal', (r) => { r.per_100g.kcal = '100'; }],
    ['null kcal', (r) => { r.per_100g.kcal = null; }],
    ['missing per_100g', (r) => { delete r.per_100g; }],
    ['negative protein', (r) => { r.per_100g.protein_g = -1; }],
    ['huge protein', (r) => { r.per_100g.protein_g = 1e9; }],
    ['string protein', (r) => { r.per_100g.protein_g = 'x'; }],
    ['negative carbs', (r) => { r.per_100g.carbs_g = -1; }],
    ['huge carbs', (r) => { r.per_100g.carbs_g = 1e9; }],
    ['string carbs', (r) => { r.per_100g.carbs_g = 'x'; }],
    ['negative fat', (r) => { r.per_100g.fat_g = -0.1; }],
    ['huge fat', (r) => { r.per_100g.fat_g = 1e9; }],
    ['string fat', (r) => { r.per_100g.fat_g = 'x'; }],
    ['negative fibre', (r) => { r.per_100g.fibre_g = -1; }],
    ['huge fibre', (r) => { r.per_100g.fibre_g = 1e9; }],
    ['string fibre', (r) => { r.per_100g.fibre_g = 'x'; }],
    ['fibre missing', (r) => { delete r.per_100g.fibre_g; }],
    ['id not a uuid', (r) => { r.id = 'not-a-uuid'; }],
    ['id missing', (r) => { delete r.id; }],
    ['id null', (r) => { r.id = null; }],
    ['empty name', (r) => { r.name = ''; }],
    ['5000 character name', (r) => { r.name = 'x'.repeat(5000); }],
    ['name number', (r) => { r.name = 5; }],
    ['name_hi number', (r) => { r.name_hi = 5; }],
    ['name_hi over 200 characters', (r) => { r.name_hi = 'x'.repeat(201); }],
    ['fatty a string', (r) => { r.fatty = 'yes'; }],
    ['fatty missing', (r) => { delete r.fatty; }],
    ['aliases not a list', (r) => { r.aliases = 'a'; }],
    ['aliases with a number', (r) => { r.aliases = ['a', 1]; }],
    ['aliases missing', (r) => { delete r.aliases; }],
    ['source missing', (r) => { delete r.source; }],
    ['source licence missing', (r) => { delete r.source.licence; }],
    ['source code not in the contract list (ifct)', (r) => { r.source.code = 'ifct'; }],
    ['source url javascript:', (r) => { r.source.url = 'javascript:alert(1)'; }],
    ['source url http:', (r) => { r.source.url = 'http://example.org/'; }],
    ['source url very long', (r) => { r.source.url = 'https://e.org/' + 'a'.repeat(3000); }],
    ['source name empty', (r) => { r.source.name = ''; }],
    ['source licence empty', (r) => { r.source.licence = ''; }],
    ['source reference over 200 characters', (r) => { r.source.reference = 'r'.repeat(201); }],
    ['updated_at missing', (r) => { delete r.updated_at; }],
  ];

  it.each(rawCases)('raw: a row with %s rejects the whole copy, and About, the builder and the picker agree', async (_n, mutate) => {
    const keys = await shippedKeys();
    await launch({ 'raw-ingredients': rawWith((b) => mutate(b.ingredients[b.ingredients.length - 1])) });
    expect(rawNames()).not.toContain('Server-only test ingredient');
    expect(getRawNames()).not.toContain('Server-only test ingredient');
    expect(getRawIngredients()).toHaveLength(rawCount);
    expect(getFoodSources().map(sourceKey)).toEqual(keys);
  });

  it.each([[null], [[]], ['text'], [{ ingredients: [] }], [{ ingredients: 'x' }], [{ ingredients: [null] }]])('raw: rejects %j', async (value) => {
    await launch({ 'raw-ingredients': value });
    expect(getRawIngredients()).toHaveLength(rawCount);
  });

  it('raw: a copy that drops or renames a shipped ingredient is rejected whole', async () => {
    await launch({ 'raw-ingredients': rawWith((b) => { b.ingredients.splice(1, 1); }) });
    expect(rawNames()).not.toContain('Server-only test ingredient');
    await launch({ 'raw-ingredients': rawWith((b) => { b.ingredients[1].name = 'Renamed'; }) });
    expect(rawNames()).not.toContain('Renamed');
    expect(getRawIngredients()).toHaveLength(rawCount);
  });

  it('raw: accepts null fibre, no name_hi and a 200 character name', async () => {
    await launch({ 'raw-ingredients': rawWith((b) => { const r = b.ingredients[b.ingredients.length - 1]; r.per_100g.fibre_g = null; delete r.name_hi; r.name = 'x'.repeat(200); }) });
    expect(rawNames()).toContain('x'.repeat(200));
  });

  const recipeCases: [string, (r: Obj) => void][] = [
    ['id not a uuid', (r) => { r.id = 'nope'; }],
    ['id missing', (r) => { delete r.id; }],
    ['empty name', (r) => { r.name = ''; }],
    ['5000 character name', (r) => { r.name = 'x'.repeat(5000); }],
    ['name number', (r) => { r.name = 5; }],
    ['wrong kind', (r) => { r.kind = r.kind === 'library' ? 'preset' : 'library'; }],
    ['kind missing', (r) => { delete r.kind; }],
    ['ingredients missing', (r) => { delete r.ingredients; }],
    ['ingredients empty', (r) => { r.ingredients = []; }],
    ['ingredients not a list', (r) => { r.ingredients = 'x'; }],
    ['ingredient not an object', (r) => { r.ingredients = [null]; }],
    ['ingredient name not in the raw table', (r) => { r.ingredients[0].ingredient = 'Unobtainium'; }],
    ['ingredient name number', (r) => { r.ingredients[0].ingredient = 5; }],
    ['ingredient amount 0', (r) => { r.ingredients[0].amount = 0; }],
    ['ingredient amount negative', (r) => { r.ingredients[0].amount = -5; }],
    ['ingredient amount huge', (r) => { r.ingredients[0].amount = 1e9; }],
    ['ingredient amount string', (r) => { r.ingredients[0].amount = '5'; }],
    ['ingredient unit cup', (r) => { r.ingredients[0].unit = 'cup'; }],
    ['ingredient unit missing', (r) => { delete r.ingredients[0].unit; }],
    ['katoris 0', (r) => { r.katoris = 0; }],
    ['katoris negative', (r) => { r.katoris = -1; }],
    ['katoris huge', (r) => { r.katoris = 1e6; }],
    ['katoris string', (r) => { r.katoris = '4'; }],
    ['katoris missing', (r) => { delete r.katoris; }],
    ['source missing', (r) => { delete r.source; }],
    ['source code not in the contract list', (r) => { r.source.code = 'ifct'; }],
    ['source url http:', (r) => { r.source.url = 'http://example.org/'; }],
    ['updated_at missing', (r) => { delete r.updated_at; }],
    ['time_min 0', (r) => { r.time_min = 0; }],
    ['time_min negative', (r) => { r.time_min = -5; }],
    ['time_min huge', (r) => { r.time_min = 1e6; }],
    ['time_min string', (r) => { r.time_min = '30'; }],
    ['cost number', (r) => { r.cost = 5; }],
    ['cost empty', (r) => { r.cost = ''; }],
    ['cost 5000 characters', (r) => { r.cost = 'x'.repeat(5000); }],
    ['tags number', (r) => { r.tags = 5; }],
    ['tags empty', (r) => { r.tags = ''; }],
    ['tags 5000 characters', (r) => { r.tags = 'x'.repeat(5000); }],
    ['steps not a list', (r) => { r.steps = 'x'; }],
    ['steps with a number', (r) => { r.steps = ['a', 1]; }],
    ['steps with an empty step', (r) => { r.steps = ['a', '']; }],
    ['steps with a 5000 character step', (r) => { r.steps = ['x'.repeat(5000)]; }],
  ];

  it.each(recipeCases)('library: a recipe with %s rejects the whole copy', async (_n, mutate) => {
    const bad = recipesWith((b) => mutate(b.library[b.library.length - 1]));
    await launch({ recipes: bad });
    expect(libNames()).not.toContain('Server-only test recipe');
    expect(presetNames()).not.toContain('Server-only test recipe');
    expect(getLibrary()).toHaveLength(shippedRecipes.library.length);
    expect(getKatoriG()).toBe(shippedRecipes.katori_g);
  });

  it.each(recipeCases.filter(([n]) => !/time_min|cost|tags|steps|wrong kind/.test(n)))('presets: a recipe with %s rejects the whole copy', async (_n, mutate) => {
    await launch({ recipes: recipesWith((b) => mutate(b.presets[b.presets.length - 1])) });
    expect(libNames()).not.toContain('Server-only test recipe');
    expect(getPresets()).toHaveLength(shippedRecipes.presets.length);
  });

  it('a preset of kind library and a library recipe of kind preset are rejected', async () => {
    await launch({ recipes: recipesWith((b) => { b.presets[b.presets.length - 1].kind = 'library'; }) });
    expect(presetNames()).not.toContain('Server-only test recipe');
  });

  const bundleCases: [string, (b: Obj) => void][] = [
    ['katori_g 0', (b) => { b.katori_g = 0; }],
    ['katori_g negative', (b) => { b.katori_g = -150; }],
    ['katori_g huge', (b) => { b.katori_g = 1e9; }],
    ['katori_g string', (b) => { b.katori_g = '150'; }],
    ['katori_g missing', (b) => { delete b.katori_g; }],
    ['empty library', (b) => { b.library = []; }],
    ['library not a list', (b) => { b.library = 'x'; }],
    ['library missing', (b) => { delete b.library; }],
    ['empty presets', (b) => { b.presets = []; }],
    ['presets not a list', (b) => { b.presets = 'x'; }],
    ['presets missing', (b) => { delete b.presets; }],
  ];
  it.each(bundleCases)('recipes: %s rejects the copy', async (_n, mutate) => {
    await launch({ recipes: recipesWith(mutate) });
    expect(libNames()).not.toContain('Server-only test recipe');
    expect(getKatoriG()).toBe(shippedRecipes.katori_g);
    expect(getLibrary()).toHaveLength(shippedRecipes.library.length);
    expect(getPresets()).toHaveLength(shippedRecipes.presets.length);
  });

  it.each([[null], [[]], ['text'], [{}]])('recipes: rejects %j', async (value) => {
    await launch({ recipes: value });
    expect(getLibrary()).toHaveLength(shippedRecipes.library.length);
  });

  it('recipes: a recipe may only use ingredients every accepted raw table has, and accepts 100 katoris and a 1000 character step', async () => {
    await launch({ recipes: recipesWith((b) => { const r = b.library[b.library.length - 1]; r.katoris = 100; r.time_min = 1440; r.steps = ['x'.repeat(1000)]; }) });
    expect(libNames()).toContain('Server-only test recipe');
    for (const r of getLibrary()) for (const i of r.ingredients) expect(rawNames()).toContain(i.ingredient);
  });

  it('recipes and raw are decided independently, and a stored recipes copy still finds its ingredients when raw is rejected', async () => {
    await launch({ recipes: recipesWith(() => undefined), 'raw-ingredients': rawWith((b) => { b.ingredients[0].per_100g.kcal = -1; }) });
    expect(libNames()).toContain('Server-only test recipe');
    expect(getRawIngredients()).toHaveLength(rawCount);
    for (const r of [...getLibrary(), ...getPresets()]) for (const i of r.ingredients) expect(rawNames()).toContain(i.ingredient);
    expect(chosenRecipes()).toBe(chosenRecipes());
    expect(chosenRaw()).toBe(chosenRaw());
  });
});

describe('About sources follow the same raw-ingredients decision as the builder', () => {
  it('a valid raw copy gives About its sources and the builder its rows', async () => {
    await launch({ 'raw-ingredients': rawWith((b) => { b.ingredients[b.ingredients.length - 1].source = SRC; }) });
    expect(rawNames()).toContain('Server-only test ingredient');
    expect(getFoodSources().map(sourceKey)).toContain('kitchen_test|Server source');
  });

  it('a copy with valid sources but a bad kcal is rejected by both', async () => {
    const keys = await shippedKeys();
    await launch({ 'raw-ingredients': rawWith((b) => { b.ingredients[b.ingredients.length - 1].source = SRC; b.ingredients[0].per_100g.kcal = 'x'; }) });
    expect(getRawIngredients()).toHaveLength(rawCount);
    expect(getFoodSources().map(sourceKey)).toEqual(keys);
    expect(getFoodSources().map(sourceKey)).not.toContain('kitchen_test|Server source');
  });

  it('a row with no source is rejected by both', async () => {
    const keys = await shippedKeys();
    await launch({ 'raw-ingredients': rawWith((b) => { delete b.ingredients[b.ingredients.length - 1].source; }) });
    expect(rawNames()).not.toContain('Server-only test ingredient');
    expect(getFoodSources().map(sourceKey)).toEqual(keys);
  });

  it('a stored recipes copy does not change the About sources', async () => {
    const keys = await shippedKeys();
    await launch({ recipes: recipesWith((b) => { b.library[b.library.length - 1].source = SRC; }) });
    expect(getFoodSources().map(sourceKey)).toEqual(keys);
  });
});
