// Validates a content/exercises.json object. Returns a list of error strings.
// Every exercise referenced by a template, ladder, away map or library must have
// tags and a card.

// Keep in sync with `Muscle` in packages/api/openapi.yaml.
export const MUSCLES = [
  'chest', 'front-delt', 'side-delt', 'rear-delt', 'triceps', 'lats', 'upper-back',
  'biceps', 'forearms', 'quads', 'hams', 'glutes', 'calves', 'abs', 'lower-back',
];
const TAG_FIELDS = ['pattern', 'family', 'equipment', 'difficulty', 'primary', 'secondary', 'joints'];

function checkTags(name, t, errors) {
  for (const f of TAG_FIELDS) {
    if (!(f in t)) errors.push(`${name}: tag field "${f}" missing`);
  }
  for (const f of ['pattern', 'family', 'equipment']) {
    if (f in t && (typeof t[f] !== 'string' || !t[f])) errors.push(`${name}: ${f} must be a non-empty string`);
  }
  if ('difficulty' in t && ![1, 2, 3].includes(t.difficulty)) errors.push(`${name}: difficulty must be 1, 2 or 3`);
  for (const f of ['primary', 'secondary']) {
    if (!(f in t)) continue;
    if (!Array.isArray(t[f])) errors.push(`${name}: ${f} must be an array`);
    else for (const m of t[f]) if (!MUSCLES.includes(m)) errors.push(`${name}: unknown muscle "${m}" in ${f}`);
  }
  if ('primary' in t && Array.isArray(t.primary) && t.primary.length === 0) errors.push(`${name}: primary is empty`);
  if ('joints' in t && !Array.isArray(t.joints)) errors.push(`${name}: joints must be an array`);
}

// Keep in sync with the keys of `defaultStep` in docs/spec/golden/progression.json.
export const EXERCISE_TYPES = ['barbell', 'dumbbell', 'machine', 'cable', 'assisted', 'bodyweight', 'other', 'time'];

const isPosInt = (n) => Number.isInteger(n) && n > 0;

// Every exercise with tags must have meta (no default is documented), and meta may not
// name an exercise without tags.
function checkMeta(name, m, errors) {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    errors.push(`${name}: meta must be an object`);
    return;
  }
  if (!EXERCISE_TYPES.includes(m.type)) errors.push(`${name}: meta type must be one of ${EXERCISE_TYPES.join(', ')}`);
  if (!isPosInt(m.rep_low)) errors.push(`${name}: meta rep_low must be a positive integer`);
  if (!isPosInt(m.rep_high)) errors.push(`${name}: meta rep_high must be a positive integer`);
  if (isPosInt(m.rep_low) && isPosInt(m.rep_high) && m.rep_low > m.rep_high) {
    errors.push(`${name}: meta rep_low must be <= rep_high`);
  }
  for (const k of Object.keys(m)) if (!['type', 'rep_low', 'rep_high'].includes(k)) errors.push(`${name}: unknown meta field "${k}"`);
}

function checkCard(name, c, errors) {
  // The prototype reads where_to_feel, setup, key_cues, common_mistakes and
  // misplaced_feel without guards; breathing, easier_version and harder_version
  // are optional. See tools/README.md for the key mapping.
  if (typeof c.where_to_feel !== 'string' || !c.where_to_feel) {
    errors.push(`${name}: card "where_to_feel" must be a non-empty string`);
  }
  for (const f of ['setup', 'key_cues', 'common_mistakes', 'misplaced_feel']) {
    if (!Array.isArray(c[f]) || c[f].length === 0) errors.push(`${name}: card "${f}" must be a non-empty array`);
  }
  for (const f of ['setup', 'key_cues', 'common_mistakes']) {
    if (Array.isArray(c[f]) && !c[f].every((x) => typeof x === 'string')) errors.push(`${name}: card "${f}" entries must be strings`);
  }
  const w = c.misplaced_feel;
  if (Array.isArray(w) && !w.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => typeof y === 'string'))) {
    errors.push(`${name}: card "misplaced_feel" entries must be [label, fix] string pairs`);
  }
  for (const f of ['breathing', 'easier_version', 'harder_version']) {
    if (f in c && typeof c[f] !== 'string') errors.push(`${name}: card "${f}" must be a string`);
  }
  const known = ['where_to_feel', 'setup', 'key_cues', 'common_mistakes', 'misplaced_feel', 'breathing', 'easier_version', 'harder_version'];
  for (const k of Object.keys(c)) if (!known.includes(k)) errors.push(`${name}: unknown card field "${k}"`);
}

/**
 * @param content parsed content/exercises.json
 * @param templates map of template name -> exercise names (from plan content)
 */
export function validateExercises(content, templates = {}) {
  const errors = [];
  const tags = content.tags ?? {};
  const cards = content.cards ?? {};

  for (const [n, t] of Object.entries(tags)) checkTags(n, t, errors);
  for (const [n, c] of Object.entries(cards)) checkCard(n, c, errors);
  const meta = content.meta ?? {};
  for (const [n, m] of Object.entries(meta)) {
    checkMeta(n, m, errors);
    if (!(n in tags)) errors.push(`${n}: meta without tags`);
  }
  for (const n of Object.keys(tags)) if (!(n in meta)) errors.push(`${n}: no meta (type and rep range)`);

  const refs = new Map(); // name -> Set of where
  const ref = (name, where) => {
    if (name === null || name === undefined) return; // null = no home alternative
    if (!refs.has(name)) refs.set(name, new Set());
    refs.get(name).add(where);
  };
  for (const [t, names] of Object.entries(templates)) names.forEach((n) => ref(n, `template "${t}"`));
  for (const [id, l] of Object.entries(content.ladders ?? {})) {
    l.steps.flat().forEach((n) => ref(n, `ladder "${id}"`));
  }
  for (const [set, map] of Object.entries(content.away_map ?? {})) {
    for (const [k, alts] of Object.entries(map)) {
      ref(k, `away map "${set}"`);
      alts.forEach((n) => ref(n, `away map "${set}"`));
    }
  }
  for (const [g, names] of Object.entries(content.library ?? {})) names.forEach((n) => ref(n, `library "${g}"`));

  for (const [name, where] of [...refs].sort(([a], [b]) => a.localeCompare(b))) {
    const w = [...where].join(', ');
    if (!(name in tags)) errors.push(`${name}: no tags (used in ${w})`);
    if (!(name in cards)) errors.push(`${name}: no card (used in ${w})`);
  }
  return errors;
}
