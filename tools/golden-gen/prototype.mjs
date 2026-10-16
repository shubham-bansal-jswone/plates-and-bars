// Loads pieces of the prototype (docs/prototype/plate-and-bar.html) and runs its own code in a vm sandbox.
// Nothing is re-typed: a piece is a run of top-level lines copied from the HTML, as core's tests slice them.
import vm from 'node:vm';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returns the top-level statements (column 0) that declare or mutate `name`, in file order:
//   const NAME = ...   function NAME(...) {...}   NAME[...] = ...   NAME.push(...)   Object.assign(NAME, ...)
//   [...].forEach(... NAME ...)
// A statement is the shortest run of lines from its first line that parses as JavaScript.
export function statementsOf(html, name) {
  if (cache.html !== html) { cache.html = html; cache.byName = new Map(); }
  if (!cache.byName.has(name)) cache.byName.set(name, scan(html, name));
  return cache.byName.get(name);
}
const cache = { html: null, byName: new Map() };

function scan(html, name) {
  const n = escapeRe(name);
  const start = new RegExp(`^(?:const ${n} =|function ${n}\\(|${n}[.\\[]|Object\\.assign\\(${n},|\\[.*\\]\\.forEach\\(.*\\b${n}\\b)`);
  const lines = html.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!start.test(lines[i])) continue;
    let text = '';
    for (let j = i; j < lines.length; j++) {
      text += `${lines[j]}\n`;
      // A statement ends on its first line, on a line ending in ";", or a line that starts at column 0 with a closing bracket (a function body);
      // trying only those lines keeps the number of parse attempts small.
      if ((j === i || /;\s*$/.test(lines[j]) || /^}/.test(lines[j])) && parses(text)) { out.push(text.trimEnd()); i = j; break; }
      if (j - i > 400) throw new Error(`prototype: no end found for the statement starting ${lines[i].slice(0, 60)}`);
    }
  }
  if (!out.length) throw new Error(`prototype: nothing found for ${name}`);
  return out;
}

function parses(text) {
  try { new vm.Script(text); return true; } catch { return false; }
}

// Runs `names` (their statements, in the order given) in a fresh context.
// The vm context isolates globals so output is repeatable (no clock, no host state); it is not a security boundary, and the
// input must be the repo's own prototype, never untrusted HTML.
// Returns `get(expr)`, which evaluates an expression in that context and returns a plain JSON copy of the result
// (top-level `const`s are not properties of the context, so they are read this way).
// `pre` is code run first (helpers the statements use). Dates are the host's, so callers must not depend on "today".
export function load(html, names, { pre = '' } = {}) {
  const ctx = vm.createContext({});
  const code = [pre, ...names.flatMap((n) => statementsOf(html, n))].join('\n');
  vm.runInContext(code, ctx, { timeout: 5000 });
  return (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx, { timeout: 5000 })));
}
