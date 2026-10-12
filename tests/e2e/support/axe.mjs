/**
 * Known axe failures are matched by rule AND element, so a new violation of the same rule on another element still
 * fails, and an entry that matches nothing (the bug was fixed) is reported as stale.
 * An entry is `{ rule, issue, match }`; `match(node)` gets the axe node (`html`, `target`).
 */
export function triage(violations, known = []) {
  const used = new Set();
  const unexpected = [];
  for (const v of violations) {
    for (const node of v.nodes) {
      const entry = known.find((k) => k.rule === v.id && k.match(node));
      if (entry) used.add(entry);
      else unexpected.push(`${v.id} (${v.impact}): ${v.help}\n    ${node.target.join(' ')}  ${node.html.slice(0, 160)}`);
    }
  }
  const stale = known.filter((k) => !used.has(k)).map((k) => `${k.rule} (#${k.issue}) matched no element: the bug is fixed, remove the entry`);
  return { unexpected, stale };
}

/** Matches a node whose html contains the text. */
export const htmlHas = (text) => (node) => node.html.includes(text);
