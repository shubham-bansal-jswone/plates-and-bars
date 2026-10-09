import { cantDefaultScope, cantScopeOptions, type ExclusionReason, type ExerciseTag } from '../src/index';
import { loadGolden, prototypeSource, sliceBlock, sliceLine } from './helpers';

// No golden cases exist for the "can't do" sheet's scope step; both rules are checked against the
// prototype's own defaultScope() and the scope step's opts list in renderCant(), sliced out of the HTML
// and run on golden/exercises.json tags, for every exercise and reason, plus untagged names.

interface ProtoTag {
  p: string;
  f: string;
  eq: string;
  d: number;
  m: string[];
  s: string[];
  j: string[];
}

interface ProtoCx {
  name: string;
  reason: string;
  scope: string;
  key: string;
}

const g = loadGolden<{ tags: Record<string, ProtoTag> }>('exercises');
const tags: Record<string, ExerciseTag> = Object.fromEntries(
  Object.entries(g.tags).map(([n, t]) => [n, { pattern: t.p, family: t.f, equipment: t.eq, difficulty: t.d, primary: t.m, secondary: t.s, joints: t.j }]),
);

/** The trimmed line of `block` starting with `start`. */
function lineIn(block: string, start: string): string {
  const line = block.split('\n').find((l) => l.trim().startsWith(start));
  if (line === undefined) throw new Error(`prototype: no line starting with ${start}`);
  return line.trim();
}

const proto = (() => {
  const src = prototypeSource();
  const render = sliceBlock(src, 'function renderCant(){', '}');
  const code = [
    sliceLine(src, 'const CX = '),
    sliceBlock(src, 'function defaultScope(){', '}'),
    'function scopeOpts(){',
    '  const t = TAGS[CX.name];',
    lineIn(render, 'const famCount = '),
    lineIn(render, "const opts = [['exercise'"),
    lineIn(render, 'if(t && famCount > 1) opts.push('),
    lineIn(render, "if(t) opts.push(['pattern'"),
    lineIn(render, 'if(t) t.j.forEach('),
    '  return opts;',
    '}',
    'return { CX, defaultScope, scopeOpts };',
  ].join('\n');
  const labels = { FAMILY: new Proxy({}, { get: (_, k) => `F:${String(k)}` }), PATTERN: new Proxy({}, { get: (_, k) => `P:${String(k)}` }), JOINT: new Proxy({}, { get: (_, k) => `J:${String(k)}` }) };
  return new Function('TAGS', 'FAMILY', 'PATTERN', 'JOINT', code)(g.tags, labels.FAMILY, labels.PATTERN, labels.JOINT) as {
    CX: ProtoCx;
    defaultScope(): void;
    scopeOpts(): [string, string, string, string][];
  };
})();

const NAMES = [...Object.keys(g.tags), 'My Custom Lift', ''];
const REASONS: (ExclusionReason | null)[] = ['pain', 'equip', 'dislike', 'form', null];

describe('cantDefaultScope', () => {
  it('matches prototype defaultScope() for every exercise and reason', () => {
    let n = 0;
    for (const name of NAMES) {
      for (const reason of REASONS) {
        Object.assign(proto.CX, { name, reason: reason ?? '', scope: '', key: '' });
        proto.defaultScope();
        expect(cantDefaultScope(name, reason, tags)).toEqual({ scope: proto.CX.scope, key: proto.CX.key });
        n++;
      }
    }
    expect(n).toBe(NAMES.length * REASONS.length);
  });

  it('pain: the first joint; form: the family; others: just the exercise', () => {
    expect(cantDefaultScope('Barbell Bench Press', 'pain', tags)).toEqual({ scope: 'joint', key: 'shoulder' });
    expect(cantDefaultScope('Barbell Bench Press', 'form', tags)).toEqual({ scope: 'family', key: 'bench' });
    expect(cantDefaultScope('Barbell Bench Press', 'equip', tags)).toEqual({ scope: 'exercise', key: 'Barbell Bench Press' });
    expect(cantDefaultScope('Barbell Bench Press', null, tags)).toEqual({ scope: 'exercise', key: 'Barbell Bench Press' });
  });

  it('pain on an exercise that loads no joint, and any reason on an untagged name: just the exercise', () => {
    expect(tags['Crunch']?.joints).toEqual([]);
    expect(cantDefaultScope('Crunch', 'pain', tags)).toEqual({ scope: 'exercise', key: 'Crunch' });
    expect(cantDefaultScope('My Custom Lift', 'form', tags)).toEqual({ scope: 'exercise', key: 'My Custom Lift' });
  });
});

describe('cantScopeOptions', () => {
  it('matches the scope options of prototype renderCant() for every exercise', () => {
    for (const name of NAMES) {
      proto.CX.name = name;
      const want = proto.scopeOpts().map(([scope, key, , sub]) => ({ scope, key, count: scope === 'family' ? Number(sub.split(' ')[0]) : null }));
      expect(cantScopeOptions(name, tags)).toEqual(want);
    }
  });

  it('exercise, family with its catalog count, pattern, then each joint in tag order', () => {
    const fam = Object.values(tags).filter((t) => t.family === 'bench').length;
    expect(fam).toBeGreaterThan(1);
    expect(cantScopeOptions('Barbell Bench Press', tags)).toEqual([
      { scope: 'exercise', key: 'Barbell Bench Press', count: null },
      { scope: 'family', key: 'bench', count: fam },
      { scope: 'pattern', key: 'h-press', count: null },
      { scope: 'joint', key: 'shoulder', count: null },
      { scope: 'joint', key: 'elbow', count: null },
      { scope: 'joint', key: 'wrist', count: null },
    ]);
  });

  it('leaves out a family of one, and offers only the exercise for an untagged name', () => {
    const one = { ...tags, Solo: { pattern: 'calf', family: 'solo', equipment: 'none', difficulty: 1, primary: [], secondary: [], joints: [] } };
    expect(cantScopeOptions('Solo', one)).toEqual([
      { scope: 'exercise', key: 'Solo', count: null },
      { scope: 'pattern', key: 'calf', count: null },
    ]);
    expect(cantScopeOptions('My Custom Lift', tags)).toEqual([{ scope: 'exercise', key: 'My Custom Lift', count: null }]);
  });
});
