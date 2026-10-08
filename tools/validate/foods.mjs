// Validates a content/foods.json object. Returns a list of error strings.
// Checks the Food schema in packages/api/openapi.yaml, macro sanity, source/licence and duplicates.

// Keep in sync with FoodSource.code in packages/api/openapi.yaml.
export const SOURCE_CODES = ['usda_fdc', 'fssai', 'own_recipe', 'kitchen_test', 'label_typical'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FOOD_KEYS = ['id', 'name', 'name_hi', 'aliases', 'serving', 'per_serving', 'fruit_veg_servings', 'source', 'updated_at'];
const NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fibre_g', 'added_sugar_g', 'fat_g'];
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const norm = (s) => s.trim().toLowerCase();

// kcal should be close to 4*protein + 4*carbs + 9*fat. Rounding and fibre (about 2 kcal/g, counted as carbs)
// make exact equality wrong, so allow 15 kcal or 15 % of the label value, whichever is larger.
// Alcohol (eat-out drinks flagged `alcohol: true`) is exempt from the upper bound; see validateEatOut.
export const kcalTolerance = (kcal) => Math.max(15, kcal * 0.15);

// opts.extraKeys: allowed fields beyond FOOD_KEYS. opts.alcohol: kcal may exceed 4/4/9 (alcohol is 7 kcal/g and not in the macros).
function checkFood(f, errors, opts = {}) {
  const at = nonEmpty(f.name) ? f.name : `(row ${f.id ?? '?'})`;
  const err = (m) => errors.push(`${at}: ${m}`);
  for (const k of FOOD_KEYS) if (!(k in f)) err(`field "${k}" missing`);
  for (const k of Object.keys(f)) if (!FOOD_KEYS.includes(k) && !(opts.extraKeys ?? []).includes(k)) err(`unknown field "${k}"`);
  if (typeof f.id !== 'string' || !UUID.test(f.id)) err('id must be a lowercase uuid');
  if (!nonEmpty(f.name)) err('name must be a non-empty string');
  if (f.name_hi !== null && !nonEmpty(f.name_hi)) err('name_hi must be a non-empty string or null');
  if (!Array.isArray(f.aliases) || !f.aliases.every(nonEmpty)) err('aliases must be an array of non-empty strings');
  else if (new Set(f.aliases.map(norm)).size !== f.aliases.length) err('duplicate alias within the row');
  if (typeof f.updated_at !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(f.updated_at)) err('updated_at must be a UTC timestamp');
  if (!num(f.fruit_veg_servings)) err('fruit_veg_servings must be a number >= 0');

  const s = f.serving ?? {};
  if (!nonEmpty(s.label)) err('serving.label must be a non-empty string');
  if (!('grams' in s) || (s.grams !== null && !(typeof s.grams === 'number' && s.grams > 0))) err('serving.grams must be a number > 0 or null');
  // Grams logging (prototype `unitGrams`): the first "<n> g" in the label is the serving's grams.
  const plain = /(\d+)\s*g\b/.exec(s.label ?? '');
  if (plain && s.grams !== Number(plain[1])) err(`serving label "${s.label}" is in grams but serving.grams is ${s.grams}`);
  if (!plain && s.grams !== null && s.grams !== undefined) err(`serving.grams is ${s.grams} but label "${s.label}" has no weight in grams`);

  const n = f.per_serving ?? {};
  for (const k of NUTRIENTS) {
    const nullable = k === 'fibre_g' || k === 'added_sugar_g';
    if (!(k in n)) err(`per_serving.${k} missing`);
    else if (!(num(n[k]) || (nullable && n[k] === null))) err(`per_serving.${k} must be a number >= 0${nullable ? ' or null' : ''}`);
  }
  if (NUTRIENTS.every((k) => k in n && (n[k] === null || num(n[k])))) {
    const macro = n.protein_g + n.carbs_g + n.fat_g;
    if (/^\d+ g$/.test(s.label) && typeof s.grams === 'number' && macro > s.grams + 0.05) err(`macros total ${macro} g, more than the ${s.grams} g serving`);
    if (n.fibre_g !== null && n.fibre_g > n.carbs_g) err('fibre_g exceeds carbs_g (carbs include fibre)');
    if (n.added_sugar_g !== null && n.added_sugar_g > n.carbs_g) err('added_sugar_g exceeds carbs_g');
    const calc = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g;
    if (opts.alcohol) {
      if (n.kcal < calc - kcalTolerance(n.kcal)) err(`kcal ${n.kcal} is below what the macros give (4/4/9 gives ${calc.toFixed(0)})`);
    } else if (Math.abs(calc - n.kcal) > kcalTolerance(n.kcal)) err(`kcal ${n.kcal} does not match macros (4/4/9 gives ${calc.toFixed(0)})`);
  }

  const src = f.source;
  if (!src || typeof src !== 'object') err('source missing');
  else {
    if (!SOURCE_CODES.includes(src.code)) err(`source.code "${src.code}" is not one of ${SOURCE_CODES.join(', ')}`);
    if (!nonEmpty(src.name)) err('source.name missing');
    if (!nonEmpty(src.licence)) err('source.licence missing');
    for (const k of ['url', 'reference']) if (!(k in src) || (src[k] !== null && !nonEmpty(src[k]))) err(`source.${k} must be a string or null`);
  }
}

export function validateFoods(content) {
  const errors = [];
  if (!Array.isArray(content.foods) || content.foods.length === 0) return ['foods must be a non-empty array'];
  const names = new Map();
  const ids = new Set();
  for (const f of content.foods) {
    checkFood(f, errors);
    if (typeof f.name === 'string') {
      const k = norm(f.name);
      if (names.has(k)) errors.push(`${f.name}: duplicate name (also "${names.get(k)}")`);
      names.set(k, f.name);
    }
    if (ids.has(f.id)) errors.push(`${f.name}: duplicate id ${f.id}`);
    ids.add(f.id);
  }
  // An alias that equals another row's name would make that row unreachable by name.
  for (const f of content.foods) {
    for (const a of Array.isArray(f.aliases) ? f.aliases : []) {
      if (typeof a === 'string' && names.has(norm(a)) && norm(a) !== norm(f.name)) {
        errors.push(`${f.name}: alias "${a}" is the name of "${names.get(norm(a))}"`);
      }
    }
  }
  return errors;
}

// Validates content/eatout.json: cuisines with tips and dishes. Dishes are Food rows plus `cuisine`
// (and `alcohol: true` on alcoholic drinks, whose kcal may exceed 4/4/9). Names are unique across the file.
export function validateEatOut(content) {
  const errors = [];
  if (!Array.isArray(content.cuisines) || content.cuisines.length === 0) return ['cuisines must be a non-empty array'];
  const names = new Map();
  const ids = new Set();
  const cuisines = new Set();
  for (const c of content.cuisines) {
    const at = nonEmpty(c.name) ? c.name : '(cuisine)';
    if (!nonEmpty(c.name)) errors.push('cuisine name must be a non-empty string');
    else if (cuisines.has(norm(c.name))) errors.push(`${at}: duplicate cuisine`);
    cuisines.add(norm(c.name ?? ''));
    for (const k of Object.keys(c)) if (!['name', 'tips', 'dishes'].includes(k)) errors.push(`${at}: unknown field "${k}"`);
    if (!Array.isArray(c.tips) || c.tips.length === 0 || !c.tips.every(nonEmpty)) errors.push(`${at}: tips must be a non-empty array of strings`);
    if (!Array.isArray(c.dishes) || c.dishes.length === 0) { errors.push(`${at}: dishes must be a non-empty array`); continue; }
    for (const d of c.dishes) {
      if (d.cuisine !== c.name) errors.push(`${d.name}: cuisine "${d.cuisine}" does not match its group "${c.name}"`);
      if ('alcohol' in d && d.alcohol !== true) errors.push(`${d.name}: alcohol must be true when present`);
      if (d.alcohol === true && c.name !== 'Drinks') errors.push(`${d.name}: alcohol is only allowed in the Drinks cuisine`);
      checkFood(d, errors, { extraKeys: ['cuisine', 'alcohol'], alcohol: d.alcohol === true });
      if (typeof d.name === 'string') {
        const k = norm(d.name);
        if (names.has(k)) errors.push(`${d.name}: duplicate name (also "${names.get(k)}")`);
        names.set(k, d.name);
      }
      if (ids.has(d.id)) errors.push(`${d.name}: duplicate id ${d.id}`);
      ids.add(d.id);
    }
  }
  return errors;
}
