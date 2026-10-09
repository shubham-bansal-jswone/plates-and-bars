// Validators for content/raw-ingredients.json, content/recipes.json and content/meal-planning.json.
// Each returns a list of error strings. Source codes and the kcal tolerance are shared with validate/foods.mjs.
import { SOURCE_CODES, kcalTolerance } from './foods.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const pos = (x) => num(x) && x > 0;
const norm = (s) => s.trim().toLowerCase();
const UNITS = ['g', 'tsp', 'tbsp'];
export const COSTS = ['Low', 'Medium', 'High'];

function checkSource(src, err) {
  if (!src || typeof src !== 'object') return err('source missing');
  if (!SOURCE_CODES.includes(src.code)) err(`source.code "${src.code}" is not one of ${SOURCE_CODES.join(', ')}`);
  if (!nonEmpty(src.name)) err('source.name missing');
  if (!nonEmpty(src.licence)) err('source.licence missing');
  for (const k of ['url', 'reference']) if (!(k in src) || (src[k] !== null && !nonEmpty(src[k]))) err(`source.${k} must be a string or null`);
}

function checkKeys(o, allowed, err) {
  for (const k of allowed) if (!(k in o)) err(`field "${k}" missing`);
  for (const k of Object.keys(o)) if (!allowed.includes(k)) err(`unknown field "${k}"`);
}

function checkCommon(o, err) {
  if (typeof o.id !== 'string' || !UUID.test(o.id)) err('id must be a lowercase uuid');
  if (!nonEmpty(o.name)) err('name must be a non-empty string');
  if (typeof o.updated_at !== 'string' || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(o.updated_at)) err('updated_at must be a UTC timestamp');
  if (typeof o.needs_dietitian_review !== 'boolean') err('needs_dietitian_review must be true or false');
  checkSource(o.source, err);
}

function uniqueness(rows, what, errors) {
  const names = new Map();
  const ids = new Set();
  for (const r of rows) {
    if (typeof r.name === 'string') {
      const k = norm(r.name);
      if (names.has(k)) errors.push(`${r.name}: duplicate ${what} name`);
      names.set(k, r.name);
    }
    if (ids.has(r.id)) errors.push(`${r.name}: duplicate id ${r.id}`);
    ids.add(r.id);
  }
  return names;
}

export function validateRaw(content) {
  const errors = [];
  checkKeys(content, ['schema_version', 'source', 'per', 'ingredients'], (m) => errors.push(m));
  if (!Array.isArray(content.ingredients) || content.ingredients.length === 0) return [...errors, 'ingredients must be a non-empty array'];
  for (const i of content.ingredients) {
    const at = nonEmpty(i.name) ? i.name : `(row ${i.id ?? '?'})`;
    const err = (m) => errors.push(`${at}: ${m}`);
    checkKeys(i, ['id', 'name', 'name_hi', 'aliases', 'fatty', 'per_100g', 'source', 'needs_dietitian_review', 'updated_at'], err);
    checkCommon(i, err);
    if (i.name_hi !== null && !nonEmpty(i.name_hi)) err('name_hi must be a non-empty string or null');
    if (!Array.isArray(i.aliases) || !i.aliases.every(nonEmpty)) err('aliases must be an array of non-empty strings');
    if (typeof i.fatty !== 'boolean') err('fatty must be true or false');
    const n = i.per_100g ?? {};
    for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g']) if (!num(n[k])) err(`per_100g.${k} must be a number >= 0`);
    if (!num(n.fibre_g)) err('per_100g.fibre_g must be a number >= 0');
    if (['kcal', 'protein_g', 'carbs_g', 'fat_g'].every((k) => num(n[k]))) {
      const macro = n.protein_g + n.carbs_g + n.fat_g;
      if (macro > 100.05) err(`macros total ${macro} g, more than 100 g per 100 g`);
      if (n.fibre_g > n.carbs_g) err('fibre_g exceeds carbs_g (carbs include fibre)');
      const calc = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g;
      if (Math.abs(calc - n.kcal) > kcalTolerance(n.kcal)) err(`kcal ${n.kcal} does not match macros (4/4/9 gives ${calc.toFixed(0)})`);
    }
  }
  const names = uniqueness(content.ingredients, 'ingredient', errors);
  for (const i of content.ingredients) {
    for (const a of Array.isArray(i.aliases) ? i.aliases : []) {
      if (typeof a === 'string' && names.has(norm(a)) && norm(a) !== norm(i.name)) errors.push(`${i.name}: alias "${a}" is the name of "${names.get(norm(a))}"`);
    }
  }
  return errors;
}

// rawNames: names from raw-ingredients.json; every recipe ingredient must be one of them.
export function validateRecipes(content, rawNames) {
  const errors = [];
  checkKeys(content, ['schema_version', 'source', 'katori_g', 'library', 'presets'], (m) => errors.push(m));
  if (!pos(content.katori_g)) errors.push('katori_g must be a number > 0');
  const lists = [['library', 'library'], ['presets', 'preset']];
  for (const [key] of lists) if (!Array.isArray(content[key]) || content[key].length === 0) errors.push(`${key} must be a non-empty array`);
  if (errors.length) return errors;
  for (const [key, kind] of lists) {
    for (const r of content[key]) {
      const at = nonEmpty(r.name) ? r.name : `(row ${r.id ?? '?'})`;
      const err = (m) => errors.push(`${key}/${at}: ${m}`);
      checkKeys(r, ['id', 'name', 'kind', 'ingredients', 'katoris', ...(kind === 'library' ? ['time_min', 'cost', 'tags', 'steps'] : []), 'source', 'needs_dietitian_review', 'updated_at'], err);
      checkCommon(r, err);
      if (r.kind !== kind) err(`kind must be "${kind}"`);
      if (!pos(r.katoris)) err('katoris must be a number > 0');
      if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) err('ingredients must be a non-empty array');
      else {
        const seen = new Set();
        for (const g of r.ingredients) {
          if (!rawNames.has(g.ingredient)) err(`ingredient "${g.ingredient}" is not in raw-ingredients.json`);
          if (seen.has(g.ingredient)) err(`ingredient "${g.ingredient}" listed twice`);
          seen.add(g.ingredient);
          if (!pos(g.amount)) err(`ingredient "${g.ingredient}": amount must be a number > 0`);
          if (!UNITS.includes(g.unit)) err(`ingredient "${g.ingredient}": unit must be one of ${UNITS.join(', ')}`);
          for (const k of Object.keys(g)) if (!['ingredient', 'amount', 'unit'].includes(k)) err(`ingredient "${g.ingredient}": unknown field "${k}"`);
        }
      }
      if (kind === 'library') {
        if (!pos(r.time_min)) err('time_min must be a number > 0');
        if (!COSTS.includes(r.cost)) err(`cost must be one of ${COSTS.join(', ')}`);
        if (!nonEmpty(r.tags)) err('tags must be a non-empty string');
        if (!Array.isArray(r.steps) || r.steps.length === 0 || !r.steps.every(nonEmpty)) err('steps must be a non-empty array of strings');
      }
    }
    uniqueness(content[key], key, errors);
  }
  return errors;
}

const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];
const GROCERY_UNITS = ['g', 'ml', 'pcs', 'scoops', 'slices'];

// foodNames: names from foods.json plus eat-out dishes; every food keyed here must be one of them.
export function validatePlanning(content, foodNames) {
  const errors = [];
  checkKeys(content, ['schema_version', 'source', 'updated_at', 'needs_dietitian_review', 'meal_weights', 'protein_weights', 'max_portions', 'min_portions', 'grocery'], (m) => errors.push(m));
  for (const k of ['meal_weights', 'protein_weights']) {
    const w = content[k] ?? {};
    if (JSON.stringify(Object.keys(w)) !== JSON.stringify(MEALS)) errors.push(`${k} must have exactly ${MEALS.join(', ')} in that order`);
    else if (!MEALS.every((m) => pos(w[m]))) errors.push(`${k} values must be numbers > 0`);
    else if (Math.abs(MEALS.reduce((a, m) => a + w[m], 0) - 1) > 1e-9) errors.push(`${k} must sum to 1`);
  }
  for (const k of ['max_portions', 'min_portions']) {
    const m = content[k];
    if (!m || typeof m !== 'object' || Object.keys(m).length === 0) { errors.push(`${k} must be a non-empty object`); continue; }
    for (const [food, q] of Object.entries(m)) {
      if (!pos(q)) errors.push(`${k}.${food}: must be a number > 0`);
      if (foodNames && !foodNames.has(food)) errors.push(`${k}.${food}: not a food in foods.json`);
    }
  }
  for (const [food, lo] of Object.entries(content.min_portions ?? {})) {
    const hi = (content.max_portions ?? {})[food];
    if (hi !== undefined && lo > hi) errors.push(`${food}: min_portions ${lo} is above max_portions ${hi}`);
  }
  if (!Array.isArray(content.grocery) || content.grocery.length === 0) return [...errors, 'grocery must be a non-empty array'];
  const seen = new Set();
  for (const g of content.grocery) {
    const err = (m) => errors.push(`grocery/${g.food}: ${m}`);
    if (!nonEmpty(g.food)) err('food must be a non-empty string');
    else {
      if (seen.has(norm(g.food))) err('duplicate food');
      seen.add(norm(g.food));
      if (foodNames && !foodNames.has(g.food)) err('not a food in foods.json');
    }
    if (!Array.isArray(g.items) || g.items.length === 0) err('items must be a non-empty array');
    else for (const i of g.items) {
      if (!nonEmpty(i.item)) err('item must be a non-empty string');
      if (!pos(i.amount)) err(`${i.item}: amount must be a number > 0`);
      if (!GROCERY_UNITS.includes(i.unit)) err(`${i.item}: unit must be one of ${GROCERY_UNITS.join(', ')}`);
    }
  }
  return errors;
}
