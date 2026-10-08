// Maps docs/spec/golden/foods.json to the content/foods.json shape (Food in packages/api/openapi.yaml).
// Pure and deterministic: row order follows the golden file; ids are derived from names.
import { createHash } from 'node:crypto';

// Any change to a food's values must bump this, or synced clients never see it. Ids come from names,
// so renaming a food changes its id.
export const UPDATED_AT = '2026-10-08T00:00:00Z';
const ID_NAMESPACE = 'plate-and-bar/foods/v1';

// FoodSource.code values from the contract, with the descriptive fields the contract asks for.
export const SOURCES = {
  usda_fdc: {
    code: 'usda_fdc',
    name: 'USDA FoodData Central (SR Legacy)',
    licence: 'Public domain (CC0 1.0)',
    url: 'https://fdc.nal.usda.gov/',
    reference: null,
  },
  fssai: {
    code: 'fssai',
    name: 'Values derived from FSSAI composition standards',
    licence: 'Values calculated by us from published standards; no table copied',
    url: null,
    reference: null,
  },
  own_recipe: {
    code: 'own_recipe',
    name: 'Plate & Bar home recipes (calculated by weight from USDA and FSSAI-derived ingredient values)',
    licence: 'Own work',
    url: null,
    reference: null,
  },
  kitchen_test: {
    code: 'kitchen_test',
    name: 'Plate & Bar kitchen test (dish weighed while cooking)',
    licence: 'Own work',
    url: null,
    reference: null,
  },
  label_typical: {
    code: 'label_typical',
    name: 'Typical label values (packaged food)',
    licence: 'Nutrition facts read from product labels; no label database copied',
    url: null,
    reference: null,
  },
};

// Source per golden food. Basis: the prototype note (docs/prototype/plate-and-bar.html, food list hint):
// "calculated from USDA public-domain ingredient data using standard home recipes; paneer, curd and milk
// follow FSSAI composition standards; packaged foods (whey, Greek yogurt, makhana) use typical label
// values", plus ADR 005 (USDA for plain foods, own recipes for dishes). Single plain foods are usda_fdc and
// composed dishes are own_recipe. Chicken breast, cooked is the raw value divided by a cooking yield and
// buttermilk is 80 g curd in the prototype's grocery map, so both are own_recipe.
const FSSAI = ['Paneer', 'Curd / dahi', 'Toned milk'];
const LABEL = ['Whey protein', 'Greek yogurt, plain', 'Makhana, roasted'];
const USDA = [
  'Egg, whole', 'Egg white', 'Soya chunks, dry', 'Oats, dry', 'Ghee', 'Banana',
  'Apple', 'Almonds', 'Roasted chana', 'Peanuts, roasted', 'Sweet potato, boiled', 'Brown bread', 'Peanut butter',
];
const RECIPE = [
  'Roti / chapati', 'Rice, cooked', 'Dal', 'Rajma / chole', 'Mixed veg sabzi', 'Paneer bhurji', 'Chicken curry',
  'Poha', 'Upma', 'Idli', 'Dosa, plain', 'Sambar', 'Aloo paratha', 'Sprouts salad', 'Tea with milk & sugar', 'Chicken breast, cooked', 'Buttermilk (chaas)',
  'Sabudana khichdi', 'Kuttu atta roti', 'Fruit bowl',
];
export const SOURCE_OF = {};
for (const [code, names] of [['fssai', FSSAI], ['label_typical', LABEL], ['usda_fdc', USDA], ['own_recipe', RECIPE]]) {
  for (const n of names) SOURCE_OF[n] = code;
}

// Not in content until Shubham decides: the prototype note and ADR 005 do not cover alcohol. Reported in the PR.
export const HELD_BACK = ['Beer', 'Whisky, rum or vodka', 'Wine'];

// Fruit and veg servings (80 g each) per serving: PRODUCE in the prototype.
export const PRODUCE = {
  'Mixed veg sabzi': 1, 'Sprouts salad': 1, 'Fruit bowl': 2, Banana: 1, Apple: 1, Sambar: 0.5, 'Sweet potato, boiled': 1,
};

// Grams logging: ported from `unitGrams` in the prototype, the first "<n> g" in the serving label
// ("100 g" gives 100, "1 medium (30 g atta)" gives 30). Whether a bracketed ingredient weight should
// count is a spec question, not decided here.
export function servingGrams(label) {
  const m = /(\d+)\s*g\b/.exec(label);
  return m ? Number(m[1]) : null;
}

// Multi-word aliases that the prototype matches as one phrase (foodMatch checks the whole query as a
// substring of the alias string). Everything else in the golden alias string is one word per alias.
export const ALIAS_PHRASES = [
  'fox nut', 'phool makhana', 'lotus seed', 'cottage cheese', 'protein shake', 'flattened rice', 'chana masala',
  'bhuna chana', 'fruit chaat', 'desi ghee', 'sprouted moong', 'anda safedi',
];

export function splitAliases(str) {
  const out = [];
  const words = str.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const pair = ALIAS_PHRASES.find((p) => p === `${words[i]} ${words[i + 1]}`);
    if (pair) { out.push(pair); i++; } else out.push(words[i]);
  }
  return out;
}

// Deterministic UUID (version 5 layout, SHA-1) from a fixed namespace string and the food name.
export function foodId(name) {
  const h = createHash('sha1').update(`${ID_NAMESPACE}:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function importFoods(golden) {
  for (const k of ['foods', 'fibreAndAddedSugarPerServing', 'aliases']) {
    if (!(k in golden)) throw new Error(`golden foods file is missing "${k}"`);
  }
  const fib = golden.fibreAndAddedSugarPerServing;
  const foods = [];
  for (const f of golden.foods) {
    if (HELD_BACK.includes(f.name)) continue;
    const code = SOURCE_OF[f.name];
    if (!code) throw new Error(`${f.name}: no source assigned (add it to SOURCE_OF or HELD_BACK)`);
    const [fibre, sugar] = fib[f.name] ?? [null, null];
    foods.push({
      id: foodId(f.name),
      name: f.name,
      name_hi: null,
      aliases: splitAliases(golden.aliases[f.name] ?? ''),
      serving: { label: f.unit, grams: servingGrams(f.unit) },
      per_serving: {
        kcal: f.kcal, protein_g: f.protein, carbs_g: f.carbs, fibre_g: fibre, added_sugar_g: sugar, fat_g: f.fat,
      },
      fruit_veg_servings: PRODUCE[f.name] ?? 0,
      source: SOURCES[code],
      updated_at: UPDATED_AT,
    });
  }
  return { schema_version: 1, source: 'docs/spec/golden/foods.json', foods };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
