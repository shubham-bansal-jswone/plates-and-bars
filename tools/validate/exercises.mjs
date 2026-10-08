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

function checkCard(name, c, errors) {
  if (typeof c.f !== 'string' || !c.f) errors.push(`${name}: card "f" must be a non-empty string`);
  // The prototype renders f, s, c, m and w without guards; b, e and h are optional.
  for (const f of ['s', 'c', 'm', 'w']) {
    if (!Array.isArray(c[f]) || c[f].length === 0) errors.push(`${name}: card "${f}" must be a non-empty array`);
  }
  if (Array.isArray(c.w) && !c.w.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => typeof y === 'string'))) {
    errors.push(`${name}: card "w" entries must be [label, fix] string pairs`);
  }
  for (const f of ['b', 'e', 'h']) {
    if (f in c && typeof c[f] !== 'string') errors.push(`${name}: card "${f}" must be a string`);
  }
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
