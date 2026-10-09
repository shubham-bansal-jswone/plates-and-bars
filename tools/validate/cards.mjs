// Validates content/cards.json, content/measures.json and content/labels.json.
const EVIDENCE = ['Strong', 'Moderate', 'Emerging'];
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

export function validateCards(content) {
  const errors = [];
  const ids = new Set();
  const titles = new Set();
  const orders = new Set();
  if (!Array.isArray(content?.cards) || content.cards.length === 0) return ['cards must be a non-empty array'];
  for (const c of content.cards) {
    const at = `card '${c?.id}'`;
    if (!nonEmpty(c.id) || !/^[a-z][a-z0-9_]*$/.test(c.id)) errors.push(`${at}: id must be lower snake case`);
    if (ids.has(c.id)) errors.push(`${at}: duplicate id`);
    ids.add(c.id);
    for (const f of ['title', 'summary', 'body']) if (!nonEmpty(c[f])) errors.push(`${at}: ${f} missing`);
    // Cards are the only grounding for Ask why, so an unsourced card is rejected.
    if (!nonEmpty(c.source)) errors.push(`${at}: source missing`);
    if (!EVIDENCE.includes(c.evidence)) errors.push(`${at}: evidence '${c.evidence}' is not one of ${EVIDENCE.join(', ')}`);
    if (nonEmpty(c.title)) {
      if (titles.has(c.title)) errors.push(`${at}: duplicate title`);
      titles.add(c.title);
    }
    if (c.learn_order !== null && !Number.isInteger(c.learn_order)) errors.push(`${at}: learn_order must be an integer or null`);
    if (c.learn_order !== null) {
      if (orders.has(c.learn_order)) errors.push(`${at}: duplicate learn_order ${c.learn_order}`);
      orders.add(c.learn_order);
    }
    const ph = c.placeholders ?? [];
    const used = [...String(c.body ?? '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
    for (const u of used) if (!ph.includes(u)) errors.push(`${at}: body uses {${u}} not listed in placeholders`);
    for (const p of ph) if (!used.includes(p)) errors.push(`${at}: placeholder ${p} is not used in body`);
    if (c.review_status !== 'draft' && c.review_status !== 'reviewed') errors.push(`${at}: review_status must be draft or reviewed`);
  }
  return errors;
}

export function validateMeasures(content) {
  const errors = [];
  if (!Array.isArray(content?.measures) || content.measures.length === 0) return ['measures must be a non-empty array'];
  const keys = new Set();
  for (const m of content.measures) {
    if (!nonEmpty(m.key) || !nonEmpty(m.label)) errors.push(`measure '${m?.key}': key and label are required`);
    if (keys.has(m.key)) errors.push(`measure '${m.key}': duplicate key`);
    keys.add(m.key);
    if (!['all', 'female'].includes(m.default_for)) errors.push(`measure '${m.key}': default_for must be all or female`);
  }
  if (content.unit !== 'cm') errors.push('unit must be cm');
  return errors;
}

export function validateLabels(content) {
  const errors = [];
  for (const group of ['muscles', 'joints']) {
    const g = content?.[group];
    if (!g || typeof g !== 'object' || Object.keys(g).length === 0) { errors.push(`${group} must be a non-empty object`); continue; }
    const seen = new Set();
    for (const [k, v] of Object.entries(g)) {
      if (!nonEmpty(v)) errors.push(`${group}.${k}: label missing`);
      else if (seen.has(v)) errors.push(`${group}.${k}: duplicate label '${v}'`);
      seen.add(v);
    }
  }
  const r = content?.replacement_reasons ?? {};
  for (const k of ['works', 'same_movement', 'spares_joint', 'easier_on_joints', 'easier_to_learn', 'done_before']) {
    if (!nonEmpty(r[k])) errors.push(`replacement_reasons.${k} missing`);
  }
  return errors;
}
