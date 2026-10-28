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
  fibre: ['fibre_g'],
};
// Cards whose number is optional: the clause around it is wrapped in a section of the same name, so a screen that
// has no value drops the whole clause instead of showing a gap. The clause must appear verbatim in the prototype body.
export const OPTIONAL_CLAUSES = {
  fibre: { name: 'fibre_g', clause: ', which is about {fibre_g} g for your target' },
};
const SPLIT_DAYS = [2, 3, 4, 5, 6];

// Content-over-prototype differences (decided in #549, 2026-10-17). The prototype's evidence label or citation for these
// five cards is stronger than its source supports, so the shipped card says what the source supports. `from` records the
// prototype value being replaced; if the prototype changes it, the import fails so the override is reviewed again.
// Evidence stays within the existing Strong / Moderate / Emerging scale (the app and validator accept only those).
export const CARD_OVERRIDES = {
  warmup: {
    from: {
      title: 'Why warm up before the first big lift?',
      summary: 'A couple of lighter sets rehearse the movement and prepare your joints.',
      body: 'Specific warm-up sets at around 50% and 75% of your working weight improve performance on the heavier sets that follow and give you a final form check. They’re short and light on purpose, so they don’t tire you out. Later exercises in the session usually don’t need them because you’re already warm.',
      evidence: 'Moderate',
      source: 'Common strength-training practice; Fradkin et al., 2010 (warm-up and performance review)',
    },
    set: {
      // Copy follows the graduated ramp and later-compound warm-ups (#1240, #1263); no numbers, so it cannot drift from core WARMUP_RAMP_*.
      title: 'Why warm up before a big lift?',
      summary: 'A few lighter sets rehearse the movement and prepare your joints.',
      body: 'Before a heavy compound lift, a few lighter sets that build up toward your working weight improve performance on the heavier sets that follow and give you a final form check. The same applies to a later compound lift that works muscles no earlier big lift has used today. The sets are short and light on purpose, so they do not tire you out. Exercises whose muscles an earlier big lift already warmed up usually do not need them.',
      evidence: 'Emerging',
      source: 'Common strength-training practice (coaching convention, limited direct evidence); Fradkin et al., 2010 (warm-up and performance review)',
    },
  },
  focus: {
    from: { evidence: 'Moderate', source: 'Schoenfeld, Ogborn & Krieger, 2017 (volume dose-response); Nunes et al., 2021, Sports Medicine (exercise order review)' },
    set: {
      evidence: 'Emerging',
      source: 'The focus rule is a coaching convention, not a tested protocol; Schoenfeld, Ogborn & Krieger, 2017 (volume dose-response); Nunes et al., 2021, European Journal of Sport Science 21(2):149-157, doi:10.1080/17461391.2020.1733672 (exercise order review)',
    },
  },
  older: {
    from: { evidence: 'Strong', source: 'WHO Guidelines on Physical Activity and Sedentary Behaviour, 2020; Bauer et al., 2013, PROT-AGE Study Group' },
    set: {
      evidence: 'Moderate',
      source: 'WHO Guidelines on Physical Activity and Sedentary Behaviour, 2020; Bauer et al., 2013, PROT-AGE Study Group (expert consensus recommendations)',
    },
  },
  fibre: {
    from: {
      evidence: 'Strong',
      source: 'ICMR-NIN Dietary Guidelines for Indians, 2024; Reynolds et al., 2019, The Lancet (fibre meta-analysis); WHO sugars guideline, 2015',
      body: 'India’s dietary guidelines recommend filling about half your plate with vegetables and fruit, and many guidelines suggest roughly 14–15 g of fibre per 1,000 kcal{?fibre_g}, which is about {fibre_g} g for your target{/fibre_g}. High-fibre foods (dals, chana, rajma, vegetables, fruit, oats, whole wheat) make a calorie deficit far easier to stick to. The WHO also advises keeping added sugars under 10% of calories, ideally under 5%.',
    },
    set: {
      evidence: 'Moderate',
      source: 'ICMR-NIN Dietary Guidelines for Indians, 2024 (plate rule); Institute of Medicine, Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids, 2005 (14 g per 1,000 kcal); Reynolds et al., 2019, The Lancet (fibre meta-analysis); WHO sugars guideline, 2015',
      body: 'The ICMR-NIN dietary guidelines for Indians (2024) recommend filling about half your plate with vegetables and fruit. The Institute of Medicine’s Dietary Reference Intakes (2005) set an adequate fibre intake of 14 g per 1,000 kcal{?fibre_g}, which is about {fibre_g} g for your target{/fibre_g}. High-fibre foods (dals, chana, rajma, vegetables, fruit, oats, whole wheat) make a calorie deficit far easier to stick to. The WHO also advises keeping added sugars under 10% of calories, ideally under 5%.',
    },
  },
  screening: {
    from: {
      evidence: 'Strong',
      source: 'Warburton et al., PAR-Q+ (Physical Activity Readiness Questionnaire for Everyone)',
      body: 'These questions are our own wording of the safety topics that pre-exercise screening tools such as the PAR-Q+ cover: heart conditions, chest pain, dizziness or fainting, long-term conditions and medicines, and joint problems. Answering yes doesn’t mean you can’t train; it means a doctor should check first and may tailor what’s safe for you. Until then the app keeps sessions light.',
    },
    set: {
      evidence: 'Moderate',
      source: 'Warburton DER, Jamnik VK, Bredin SSD, Gledhill N. The Physical Activity Readiness Questionnaire for Everyone (PAR-Q+) and Electronic Physical Activity Readiness Medical Examination (ePARmed-X+). Health & Fitness Journal of Canada 2011;4(2):3-23',
      body: 'These questions are our own wording of the safety topics that pre-exercise screening tools such as the PAR-Q+ cover: heart conditions, chest pain, dizziness or fainting, long-term conditions and medicines, and joint problems. The PAR-Q+ is our reference; these questions are not taken from it, and the official form is free at eparmedx.com. Answering yes doesn’t mean you can’t train; it means a doctor should check first and may tailor what’s safe for you. Until then the app keeps sessions light.',
    },
  },
};

// Cards held back until their sources are decided (issue #212: they cite only generic sources). The flag ships in
// content/cards.json as `hidden: true` with a `hidden_reason`; the app and the site both read it (#969). Remove an id
// here, and regenerate, once #212 is settled for that card.
export const HELD_BACK = {
  ramp: 'Source is generic ("Common coaching practice; no single study"); held back until #212 is decided.',
  ladder: 'Source is generic ("Common coaching practice"); held back until #212 is decided.',
  formfirst: 'Source is generic ("General motor-learning and strength research"); held back until #212 is decided.',
};

function applyOverride(id, card) {
  const o = CARD_OVERRIDES[id];
  if (!o) return card;
  for (const [k, v] of Object.entries(o.from)) {
    if (card[k] !== v) throw new Error(`card '${id}': prototype ${k} changed since the #549 override was written; review CARD_OVERRIDES`);
  }
  return { ...card, ...o.set };
}

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
  const kb0 = grab(html, /^const KB = \{[\s\S]*?^\};$/m, 'KB');
  // Later `Object.assign(KB, { ... });` blocks add more cards; they run in file order after the base object.
  const kb = [kb0, ...(html.match(/^Object\.assign\(KB, \{[\s\S]*?\}\s*\);$/gm) ?? [])].join('\n');
  const learn = grab(html, /^const LEARN = \[.*\];$/m, 'LEARN');
  const measures = grab(html, /^const MEASURES = \[.*\];$/m, 'MEASURES');
  const muscle = grab(html, /^const MUSCLE = \{.*\};$/m, 'MUSCLE');
  const joint = grab(html, /^const JOINT = \{.*\};$/m, 'JOINT');
  const pattern = grab(html, /^const PATTERN = \{.*\};$/m, 'PATTERN');
  const family = grab(html, /^const FAMILY = \{.*\};$/m, 'FAMILY');
  // 1000 stands in for the weight so Math.round(w * 1.6) is recognisable as 1600.
  const stub = `const S = { settings: { kcal: '{kcal}', protein: '{protein_g}', profile: ${profile} } };
    const fmt = (x) => x, r1 = (x) => (x === 1000 ? '{weight}' : x), latestWeight = () => null;
    const fibreTarget = () => '{fibre_g}';
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
  const opt = OPTIONAL_CLAUSES[id];
  if (opt) {
    const body = run(html).KB[id].body;
    if (!body.includes(opt.clause)) throw new Error(`${id}: optional clause no longer matches the prototype`);
    return body.replace(opt.clause, `{?${opt.name}}${opt.clause}{/${opt.name}}`);
  }
  if (!toggles) return run(html).KB[id].body;
  const norm = (t, d) => (id === 'split' ? splitNormalise(t, d, names[String(d)]) : t);
  const days = id === 'split' ? SPLIT_DAYS : [3];
  const bases = days.map((d) => norm(run(html, { days: d }).KB[id].body, d));
  if (bases.some((x) => x !== bases[0])) throw new Error('split text differs between day counts beyond the name');
  const variants = {};
  for (const [name, key] of Object.entries(toggles)) variants[name] = norm(run(html, { profile: PROFILES[key], days: 3 }).KB[id].body, 3);
  return sectioned(bases[0], variants);
};

function sectionNames(id) {
  if (SECTION_TOGGLES[id]) return Object.keys(SECTION_TOGGLES[id]);
  if (OPTIONAL_CLAUSES[id]) return [OPTIONAL_CLAUSES[id].name];
  throw new Error(`card '${id}' has placeholders but neither SECTION_TOGGLES nor OPTIONAL_CLAUSES entry`);
}

export function importCards(html) {
  const p = extractScience(html);
  const names = splitNames(html);
  const m = /list\.splice\((\d+), 0, 'bulky'\)/.exec(html);
  if (!m) throw new Error("the female-only 'bulky' learn-list insertion not found in the prototype");
  const learnIds = p.LEARN;
  const cards = Object.entries(p.KB).map(([id, c]) => applyOverride(id, {
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
    ...(PLACEHOLDERS[id] ? { placeholders: PLACEHOLDERS[id], sections: sectionNames(id) } : {}),
    review_status: 'draft',
    ...(HELD_BACK[id] ? { hidden: true, hidden_reason: HELD_BACK[id] } : {}),
  }));
  return { schema_version: 1, origin: 'docs/prototype/plate-and-bar.html (KB, LEARN), with CARD_OVERRIDES in tools/cards-import/import.mjs', split_names: names, cards };
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
