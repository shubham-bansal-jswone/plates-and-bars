// Extracts KB, LEARN, MEASURES, MUSCLE and JOINT (and the replacement-reason phrases) from the prototype.
// Pure and deterministic. Output: content/cards.json, content/measures.json, content/labels.json.
import vm from 'node:vm';

// Cards whose prototype body is built from the user's own numbers. Their bodies are exported with {placeholders}
// instead of one user's numbers; the app fills them from the user's data. `split` is a static rewrite because the
// prototype picks its wording from the number of training days (see SPLIT_BODY).
export const PLACEHOLDERS = { targets: ['kcal', 'protein_g'], protein: ['protein_g'], split: ['days', 'split_name'] };
export const SPLIT_BODY = 'You train {days} days a week, so your plan uses {split_name}, which trains each muscle about twice a week; that works at least as well as once. Sessions are trimmed to fit your time, keeping the big compound lifts first while you’re fresh and smaller exercises after. One exercise does each job, so you won’t see two curl variations back to back. Across the week the plan aims for roughly 10 hard sets per muscle.';
export const SPLIT_NAMES = { 2: 'two full-body sessions', 3: 'three full-body sessions', 4: 'an upper/lower split', 5: 'a push/pull/legs plus upper/lower hybrid', 6: 'push/pull/legs twice' };

// Replacement-reason phrases from candidates() in the prototype. Each must appear verbatim in the source.
export const REASON_SOURCE_SNIPPETS = {
  works: '`works your ${listJoin(prim.map(x => MUSCLE[x]))}`',
  same_movement: "'same movement'",
  spares_joint: '`doesn’t load the ${JOINT[o.joint]}`',
  easier_on_joints: "'easier on the joints'",
  easier_to_learn: "'easier to learn'",
  done_before: "'you’ve done it before'",
};

const grab = (html, re, what) => {
  const m = re.exec(html);
  if (!m) throw new Error(`${what} not found in the prototype`);
  return m[0];
};

// Runs data-literal statements in an empty context; KB bodies are called with neutral stub state.
export function extractScience(html) {
  const kb = grab(html, /^const KB = \{[\s\S]*?^\};$/m, 'KB');
  const learn = grab(html, /^const LEARN = \[.*\];$/m, 'LEARN');
  const measures = grab(html, /^const MEASURES = \[.*\];$/m, 'MEASURES');
  const muscle = grab(html, /^const MUSCLE = \{.*\};$/m, 'MUSCLE');
  const joint = grab(html, /^const JOINT = \{.*\};$/m, 'JOINT');
  const stub = `const S = { settings: { kcal: '{kcal}', protein: '{protein_g}', profile: null } };
    const fmt = (x) => x, r1 = (x) => x, calcTargets = () => null, latestWeight = () => null;
    const splitFor = () => ({ list: { length: '{days}' } });`;
  const ctx = vm.createContext({});
  vm.runInContext(`${stub}\n${kb}\n${learn}\n${measures}\n${muscle}\n${joint}
    this.out = { KB: Object.fromEntries(Object.entries(KB).map(([k, v]) => [k, { t: v.t, s: v.s, ev: v.ev, src: v.src, body: k === 'split' ? null : v.b() }])), LEARN, MEASURES, MUSCLE, JOINT };`, ctx, { timeout: 1000 });
  return JSON.parse(JSON.stringify(ctx.out));
}

export function importCards(html) {
  const p = extractScience(html);
  const learnIds = p.LEARN;
  const cards = Object.entries(p.KB).map(([id, c]) => {
    const body = id === 'split' ? SPLIT_BODY : c.body;
    const card = {
      id,
      title: c.t,
      summary: c.s,
      body,
      evidence: c.ev,
      source: c.src,
      // Position in the prototype's "learn" reading list (null = shown only through its Why? link).
      learn_order: learnIds.includes(id) ? learnIds.indexOf(id) : null,
      ...(PLACEHOLDERS[id] ? { placeholders: PLACEHOLDERS[id] } : {}),
      // The prototype adds 'bulky' to the learn list (after the 6th card) only for female profiles.
      ...(id === 'bulky' ? { audience: 'female' } : {}),
      review_status: 'draft',
    };
    return card;
  });
  return { schema_version: 1, origin: 'docs/prototype/plate-and-bar.html (KB, LEARN)', split_names: SPLIT_NAMES, cards };
}

export function importMeasures(html) {
  const p = extractScience(html);
  return {
    schema_version: 1,
    origin: 'docs/prototype/plate-and-bar.html (MEASURES)',
    unit: 'cm',
    // The prototype lists hips only for female profiles, or when a hips value is already entered that day.
    measures: p.MEASURES.map(([key, label]) => ({ key, label, ...(key === 'hips' ? { default_for: 'female' } : { default_for: 'all' }) })),
  };
}

export function importLabels(html) {
  const p = extractScience(html);
  for (const [k, snippet] of Object.entries(REASON_SOURCE_SNIPPETS)) {
    if (!html.includes(snippet)) throw new Error(`replacement reason '${k}' no longer matches the prototype`);
  }
  return {
    schema_version: 1,
    origin: 'docs/prototype/plate-and-bar.html (MUSCLE, JOINT, candidates)',
    muscles: p.MUSCLE,
    joints: p.JOINT,
    // Text builder: "Works your {muscles}" + the clauses below joined with ", ", first letter capitalised.
    // muscles are joined as "a, b and c" (listJoin). Order: works, same_movement, spares_joint OR easier_on_joints,
    // easier_to_learn, done_before.
    replacement_reasons: {
      works: 'works your {muscles}',
      same_movement: 'same movement',
      spares_joint: 'doesn’t load the {joint}',
      easier_on_joints: 'easier on the joints',
      easier_to_learn: 'easier to learn',
      done_before: 'you’ve done it before',
    },
  };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
