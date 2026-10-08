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

// Card keys named after how the prototype renders them (openHowTo, learnHtml, feelHtml).
export const CARD_KEYS = {
  f: 'where_to_feel',
  s: 'setup',
  c: 'key_cues',
  m: 'common_mistakes',
  w: 'misplaced_feel',
  b: 'breathing',
  e: 'easier_version',
  h: 'harder_version',
};
const CARD_REQUIRED = ['f', 's', 'c', 'm', 'w'];

export function expandCard(card) {
  const extra = Object.keys(card).filter((k) => !(k in CARD_KEYS));
  if (extra.length) throw new Error(`unknown card field(s): ${extra.join(', ')}`);
  for (const k of CARD_REQUIRED) {
    if (!(k in card)) throw new Error(`card field "${k}" missing`);
  }
  const out = {};
  for (const [short, long] of Object.entries(CARD_KEYS)) {
    if (short in card) out[long] = card[short];
  }
  return out;
}

// Per-exercise type and rep range. The golden table (docs/spec/golden/progression.json,
// `exerciseMeta`) holds [type, lo, hi]; names follow the contract's
// Settings.exercise_overrides (type, rep_low, rep_high).
export function expandMeta(m) {
  if (!Array.isArray(m) || m.length !== 3) throw new Error('meta must be [type, lo, hi]');
  return { type: m[0], rep_low: m[1], rep_high: m[2] };
}

export function importExercises(golden, progression) {
  if (!progression || typeof progression.exerciseMeta !== 'object') {
    throw new Error('progression golden is missing "exerciseMeta"');
  }
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
  const cards = {};
  for (const [name, c] of Object.entries(golden.cards)) {
    try {
      cards[name] = expandCard(c);
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  const meta = {};
  for (const [name, m] of Object.entries(progression.exerciseMeta)) {
    try {
      meta[name] = expandMeta(m);
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  return {
    schema_version: 1,
    source: 'docs/spec/golden/exercises.json',
    meta_source: 'docs/spec/golden/progression.json',
    tags,
    meta,
    ladders: golden.ladders,
    away_map: { dumbbells_bodyweight: golden.awayMap_dumbbells_bodyweight },
    cards,
    library: golden.library,
  };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
