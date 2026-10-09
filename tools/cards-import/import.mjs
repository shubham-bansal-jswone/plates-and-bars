// Extracts KB, LEARN, MEASURES, MUSCLE, JOINT, FAMILY and PATTERN (and the replacement-reason phrases) from the prototype.
// Pure and deterministic. Output: content/cards.json, content/measures.json, content/labels.json.
import vm from 'node:vm';

// Cards whose prototype body is built from the user's own numbers. The exported body has {value} placeholders and
// optional inline sections: {?name}text{/name} (shown when name applies) or {?name}on{:}off{/name}. Everything is
// derived from the prototype by running its own b() with stub state; nothing is hand-typed.
export const SECTION_TOGGLES = {
  targets: { tdee: 'profile' },
  protein: { weight: 'profile' },
  split: { minutes: 'minutes', new_lifter: 'new' },
};
export const PLACEHOLDERS = {
  targets: ['kcal', 'protein_g', 'tdee', 'bmr', 'movement', 'training', 'digestion'],
  protein: ['protein_g', 'weight', 'protein_floor'],
  split: ['days', 'split_name', 'minutes'],
};
const SPLIT_DAYS = [2, 3, 4, 5, 6];

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

// Runs the data-literal statements in an empty context. KB bodies are called with stub state whose numbers are
// placeholder tokens; `profile` is a JS expression for S.settings.profile; `days` is the split's day count.
function run(html, { profile = 'null', days = 3, bodies = true } = {}) {
  const kb = grab(html, /^const KB = \{[\s\S]*?^\};$/m, 'KB');
  const learn = grab(html, /^const LEARN = \[.*\];$/m, 'LEARN');
  const measures = grab(html, /^const MEASURES = \[.*\];$/m, 'MEASURES');
  const muscle = grab(html, /^const MUSCLE = \{.*\};$/m, 'MUSCLE');
  const joint = grab(html, /^const JOINT = \{.*\};$/m, 'JOINT');
  const pattern = grab(html, /^const PATTERN = \{.*\};$/m, 'PATTERN');
  const family = grab(html, /^const FAMILY = \{.*\};$/m, 'FAMILY');
  // 1000 stands in for the weight so Math.round(w * 1.6) is recognisable as 1600.
  const stub = `const S = { settings: { kcal: '{kcal}', protein: '{protein_g}', profile: ${profile} } };
    const fmt = (x) => x, r1 = (x) => (x === 1000 ? '{weight}' : x), latestWeight = () => null;
    const calcTargets = () => ({ tdee: '{tdee}', bmr: '{bmr}', movement: '{movement}', training: '{training}', digestion: '{digestion}' });
    const splitFor = () => ({ list: { length: ${days} } });
    const Math = { round: (x) => (x === 1600 ? '{protein_floor}' : x) };`;
  const ctx = vm.createContext({});
  vm.runInContext(`${stub}\n${kb}\n${learn}\n${measures}\n${muscle}\n${joint}\n${pattern}\n${family}
    this.out = { KB: Object.fromEntries(Object.entries(KB).map(([k, v]) => [k, { t: v.t, s: v.s, ev: v.ev, src: v.src, body: ${bodies} ? v.b() : null }])), LEARN, MEASURES, MUSCLE, JOINT, PATTERN, FAMILY };`, ctx, { timeout: 1000 });
  return JSON.parse(JSON.stringify(ctx.out));
}

export const extractScience = (html) => run(html);
const PROFILES = {
  none: 'null',
  profile: "{ weight: 1000 }",
  minutes: "{ minutes: '{minutes}' }",
  new: "{ exp: 'new' }",
  all: "{ weight: 1000, minutes: '{minutes}', exp: 'new' }",
};
// The prototype's own body for a stub state, used by the drift test as the reference for rendering.
export const prototypeBody = (html, id, profileKey, days = 3) => run(html, { profile: PROFILES[profileKey], days }).KB[id].body;

// Turn "You train 3 days ... uses three full-body sessions ..." into a template, and return the name for `days`.
function splitNormalise(text, days, name) {
  return text.replace(`You train ${days} days`, 'You train {days} days').replace(name, '{split_name}');
}
function splitNames(html) {
  const names = {};
  for (const d of SPLIT_DAYS) {
    const t = run(html, { days: d }).KB.split.body;
    const m = /so your plan uses (.+?), which trains/.exec(t);
    if (!m) throw new Error('split text no longer has the expected shape');
    names[String(d)] = m[1];
  }
  return names;
}

// Builds a body with inline sections by diffing the all-off text against each single-toggle-on text.
function sectioned(base, variants) {
  const edits = [];
  for (const [name, on] of Object.entries(variants)) {
    // A diff can place the boundary in more than one equivalent spot; prefer the one where the section starts at a
    // capital letter (a whole sentence), trying suffix-first, then prefix-first.
    const region = (suffixFirst) => {
      const common = (x, y, fromEnd, max) => {
        let n = 0;
        while (n < max && (fromEnd ? x[x.length - 1 - n] === y[y.length - 1 - n] : x[n] === y[n])) n++;
        return n;
      };
      const lim = Math.min(base.length, on.length);
      let pre, suf;
      if (suffixFirst) { suf = common(base, on, true, lim); pre = common(base, on, false, lim - suf); }
      else { pre = common(base, on, false, lim); suf = common(base, on, true, lim - pre); }
      return { pre, suf, onText: on.slice(pre, on.length - suf), off: base.slice(pre, base.length - suf) };
    };
    const r = [true, false].map(region).find((x) => /^[A-Z]/.test(x.onText)) ?? region(true);
    const { pre, suf, onText, off } = r;
    edits.push({ pre, end: base.length - suf, text: `{?${name}}${onText}${off ? `{:}${off}` : ''}{/${name}}` });
  }
  edits.sort((x, y) => y.pre - x.pre);
  let out = base;
  for (const e of edits) out = out.slice(0, e.pre) + e.text + out.slice(e.end);
  return out;
}

// Renders a body: `on` lists the sections that apply, `values` fills placeholders.
export function renderBody(body, on = [], values = {}) {
  return body
    .replace(/\{\?([a-z_]+)\}([\s\S]*?)(?:\{:\}([\s\S]*?))?\{\/\1\}/g, (_, n, yes, no) => (on.includes(n) ? yes : no ?? ''))
    .replace(/\{([a-z_]+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

const bodyFor = (html, id, names) => {
  const toggles = SECTION_TOGGLES[id];
  if (!toggles) return run(html).KB[id].body;
  const norm = (t, d) => (id === 'split' ? splitNormalise(t, d, names[String(d)]) : t);
  const days = id === 'split' ? SPLIT_DAYS : [3];
  const bases = days.map((d) => norm(run(html, { days: d }).KB[id].body, d));
  if (bases.some((x) => x !== bases[0])) throw new Error('split text differs between day counts beyond the name');
  const variants = {};
  for (const [name, key] of Object.entries(toggles)) variants[name] = norm(run(html, { profile: PROFILES[key], days: 3 }).KB[id].body, 3);
  return sectioned(bases[0], variants);
};

export function importCards(html) {
  const p = extractScience(html);
  const names = splitNames(html);
  const m = /list\.splice\((\d+), 0, 'bulky'\)/.exec(html);
  if (!m) throw new Error("the female-only 'bulky' learn-list insertion not found in the prototype");
  const learnIds = p.LEARN;
  const cards = Object.entries(p.KB).map(([id, c]) => ({
    id,
    title: c.t,
    summary: c.s,
    body: bodyFor(html, id, names),
    evidence: c.ev,
    source: c.src,
    // Position in the prototype's "learn" reading list (null = not in the base list).
    learn_order: learnIds.includes(id) ? learnIds.indexOf(id) : null,
    // 'bulky' is spliced into the learn list at this index for female profiles only.
    ...(id === 'bulky' ? { audience: 'female', learn_insert_at: Number(m[1]) } : {}),
    ...(PLACEHOLDERS[id] ? { placeholders: PLACEHOLDERS[id], sections: Object.keys(SECTION_TOGGLES[id]) } : {}),
    review_status: 'draft',
  }));
  return { schema_version: 1, origin: 'docs/prototype/plate-and-bar.html (KB, LEARN)', split_names: names, cards };
}

export function importMeasures(html) {
  const p = extractScience(html);
  const rule = "k !== 'hips' || (p && p.sex === 'female') || cur.hips";
  if (!html.includes(`MEASURES.filter(([k]) => ${rule})`)) throw new Error('hips display rule no longer matches the prototype');
  return {
    schema_version: 1,
    origin: 'docs/prototype/plate-and-bar.html (MEASURES, measuresHtml)',
    unit: 'cm',
    measures: p.MEASURES.map(([key, label]) => ({
      key,
      label,
      // hips: shown for female profiles, or when a hips value is already entered for that day; all others always.
      show: key === 'hips' ? { sex: 'female', or_entered_that_day: true } : 'always',
    })),
  };
}

export function importLabels(html) {
  const p = extractScience(html);
  for (const [k, snippet] of Object.entries(REASON_SOURCE_SNIPPETS)) {
    if (!html.includes(snippet)) throw new Error(`replacement reason '${k}' no longer matches the prototype`);
  }
  return {
    schema_version: 1,
    origin: 'docs/prototype/plate-and-bar.html (MUSCLE, JOINT, FAMILY, PATTERN, candidates)',
    muscles: p.MUSCLE,
    joints: p.JOINT,
    // Used as "All {label}" in the replacement-rule scope options.
    families: p.FAMILY,
    patterns: p.PATTERN,
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
