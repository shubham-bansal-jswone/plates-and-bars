// Extracts EATOUT (and the 'Drinks' entry added later) from the prototype and maps it to content/eatout.json.
// Pure and deterministic: cuisine and dish order follow the prototype; ids are derived from names.
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Bump when any value changes so synced clients see it.
export const UPDATED_AT = '2026-10-08T00:00:00Z';
const ID_NAMESPACE = 'plate-and-bar/eatout/v1';

// The prototype calls these "rough restaurant estimates" (not weighed, not from a database): the project's own
// estimates, FoodSource code own_estimate (ADR 005).
export const SOURCE = {
  code: 'own_estimate',
  name: 'Plate & Bar own estimate for a typical restaurant portion (not weighed; portions and oil vary)',
  licence: 'Own work',
  url: null,
  reference: null,
};

// Dishes whose kcal include alcohol (7 kcal/g), which the 4/4/9 check cannot see.
export const ALCOHOLIC = ['Beer (330 ml)', 'Whisky, rum or vodka (30 ml)', 'Wine (150 ml)', 'Cocktail, sweet (200 ml)'];

export function dishId(name) {
  const h = createHash('sha1').update(`${ID_NAMESPACE}:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// Evaluates only the two EATOUT statements from the prototype source (data literals, no other code).
export function extractEatOut(html) {
  const base = /^const EATOUT = \{[\s\S]*?^\};$/m.exec(html);
  const drinks = /^EATOUT\['Drinks'\] = \{[\s\S]*?\] \};$/m.exec(html);
  if (!base || !drinks) throw new Error('EATOUT or EATOUT[\'Drinks\'] not found in the prototype');
  const ctx = vm.createContext({});
  vm.runInContext(`${base[0]}\n${drinks[0]}\nthis.EATOUT = EATOUT;`, ctx, { timeout: 1000 });
  return JSON.parse(JSON.stringify(ctx.EATOUT));
}

export function importEatOut(html) {
  const eatout = extractEatOut(html);
  const cuisines = Object.entries(eatout).map(([name, c]) => ({
    name,
    tips: c.tips,
    dishes: c.dishes.map(([dn, kcal, p, carbs, fat]) => ({
      id: dishId(dn),
      name: dn,
      name_hi: null,
      aliases: [],
      cuisine: name,
      ...(ALCOHOLIC.includes(dn) ? { alcohol: true } : {}),
      serving: { label: '1 serving', grams: null },
      per_serving: { kcal, protein_g: p, carbs_g: carbs, fibre_g: null, added_sugar_g: null, fat_g: fat },
      fruit_veg_servings: 0,
      source: SOURCE,
      updated_at: UPDATED_AT,
    })),
  }));
  return { schema_version: 1, source: 'docs/prototype/plate-and-bar.html (EATOUT)', cuisines };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
