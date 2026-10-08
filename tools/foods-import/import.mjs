// Maps docs/spec/golden/foods.json to the content/foods.json shape (Food in packages/api/openapi.yaml).
// Pure and deterministic: row order follows the golden file; ids are derived from names.
import { createHash } from 'node:crypto';

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
// values", plus ADR 002 (USDA for plain foods, own recipes for dishes). Single plain foods are usda_fdc and
// composed dishes are own_recipe.
const FSSAI = ['Paneer', 'Curd / dahi', 'Toned milk'];
const LABEL = ['Whey protein', 'Greek yogurt, plain', 'Makhana, roasted'];
const USDA = [
  'Chicken breast, cooked', 'Egg, whole', 'Egg white', 'Soya chunks, dry', 'Oats, dry', 'Ghee', 'Banana',
  'Apple', 'Almonds', 'Roasted chana', 'Peanuts, roasted', 'Sweet potato, boiled', 'Brown bread', 'Peanut butter',
];
const RECIPE = [
  'Roti / chapati', 'Rice, cooked', 'Dal', 'Rajma / chole', 'Mixed veg sabzi', 'Paneer bhurji', 'Chicken curry',
  'Poha', 'Upma', 'Idli', 'Dosa, plain', 'Sambar', 'Aloo paratha', 'Sprouts salad', 'Tea with milk & sugar',
  'Sabudana khichdi', 'Kuttu atta roti', 'Fruit bowl',
];
export const SOURCE_OF = {};
for (const [code, names] of [['fssai', FSSAI], ['label_typical', LABEL], ['usda_fdc', USDA], ['own_recipe', RECIPE]]) {
  for (const n of names) SOURCE_OF[n] = code;
}

// Not in content: nothing in the repo says where these values come from (the prototype note and ADR 002 do
// not cover alcohol, and buttermilk is not named among the FSSAI-derived dairy foods). Reported in the PR.
export const HELD_BACK = ['Buttermilk (chaas)', 'Beer', 'Whisky, rum or vodka', 'Wine'];

// Fruit and veg servings (80 g each) per serving: PRODUCE in the prototype.
export const PRODUCE = {
  'Mixed veg sabzi': 1, 'Sprouts salad': 1, 'Fruit bowl': 2, Banana: 1, Apple: 1, Sambar: 0.5, 'Sweet potato, boiled': 1,
};

// Grams logging needs the serving to be a plain weight such as "100 g". A weight inside brackets,
// like "1 medium (30 g atta)", is an ingredient weight, not the serving, so grams stays null.
export function servingGrams(label) {
  const m = /^(\d+(?:\.\d+)?) g$/.exec(label);
  return m ? Number(m[1]) : null;
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
      aliases: (golden.aliases[f.name] ?? '').split(/\s+/).filter(Boolean),
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
