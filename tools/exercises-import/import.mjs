// Maps docs/spec/golden/exercises.json to the content/exercises.json shape.
// Pure and deterministic: key order follows the golden file, tag keys use the
// contract names (Settings.custom_tags / ExerciseTags in packages/api/openapi.yaml).

export const TAG_KEYS = {
  p: 'pattern',
  f: 'family',
  eq: 'equipment',
  d: 'difficulty',
  m: 'primary',
  s: 'secondary',
  j: 'joints',
};

export function expandTags(tags) {
  const out = {};
  for (const [short, long] of Object.entries(TAG_KEYS)) {
    if (!(short in tags)) throw new Error(`tag field "${short}" missing`);
    out[long] = tags[short];
  }
  const extra = Object.keys(tags).filter((k) => !(k in TAG_KEYS));
  if (extra.length) throw new Error(`unknown tag field(s): ${extra.join(', ')}`);
  return out;
}

export function importExercises(golden) {
  const required = ['tags', 'ladders', 'awayMap_dumbbells_bodyweight', 'cards', 'library'];
  for (const k of required) {
    if (!(k in golden)) throw new Error(`golden exercises file is missing "${k}"`);
  }
  const tags = {};
  for (const [name, t] of Object.entries(golden.tags)) {
    try {
      tags[name] = expandTags(t);
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  return {
    schema_version: 1,
    source: 'docs/spec/golden/exercises.json',
    tags,
    ladders: golden.ladders,
    away_map: { dumbbells_bodyweight: golden.awayMap_dumbbells_bodyweight },
    cards: golden.cards,
    library: golden.library,
  };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
