import {
  activeRules,
  candidates,
  homeName,
  isExcluded,
  mapForWhere,
  replFromSwaps,
  resolveName,
  resolveSession,
  resolveSessionWithLost,
  ruleMatches,
  TEMPLATES,
  trimSession,
  type Candidate,
  type Exclusion,
  type ExclusionScope,
  type ResolveState,
  type Swap,
  type Where,
} from '../src/index';
import { loadGolden, prototypeSource } from './helpers';
import { loadExclusions, type ProtoRepl, type ProtoRule } from './prototype-exclusions';
import { goldenCatalog, rng } from './prototype-plan';

const catalog = goldenCatalog();
const { tags } = catalog;
const proto = loadExclusions();
const DATE = '2026-10-08';
const WHERES: Where[] = ['gym', 'dumbbells', 'bodyweight'];

const rule = (scope: ExclusionScope, key: string, more: Partial<Exclusion> = {}): Exclusion => ({ scope, key, reason: null, to: {}, done: false, ...more });
const swap = (from: string, to: string, bridge_until: string | null = null, more: Partial<Swap> = {}): Swap => ({ from, to, bridge_until, ...more });
const st = (more: Partial<ResolveState> = {}): ResolveState => ({ date: DATE, exclusions: [], swaps: [], ...more });
const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name);

/** Contract records → prototype `settings.excl` / `settings.repl`, tombstones removed (the prototype deletes them). */
function toProto(s: ResolveState): { excl: ProtoRule[]; repl: Record<string, ProtoRepl> } {
  const excl = s.exclusions.filter((r) => !r.deleted_at).map((r) => ({ scope: r.scope, key: r.key, reason: r.reason, to: { ...r.to }, done: r.done }));
  const repl: Record<string, ProtoRepl> = {};
  for (const w of s.swaps) if (!w.deleted_at) repl[w.from] = { to: w.to, bridgeUntil: w.bridge_until };
  return { excl, repl };
}

function setProto(s: ResolveState, inSession: string[] = []): void {
  proto.S.date = s.date;
  proto.S.settings = toProto(s);
  proto.S.lifts = { ...(s.lifts || {}) };
  proto.S.day = { workout: { exercises: inSession.map((name) => ({ name })) } };
}

/** The prototype's `why` text, built from the port's facts with the prototype's own labels. */
function whyText(c: Candidate): string {
  const w = [`works your ${proto.listJoin(c.why.muscles.map((x) => proto.MUSCLE[x] as string))}`];
  if (c.why.sameMovement) w.push('same movement');
  if (c.why.sparesJoint) w.push(`doesn’t load the ${proto.JOINT[c.why.sparesJoint]}`);
  else if (c.why.easierOnJoints) w.push('easier on the joints');
  if (c.why.easierToLearn) w.push('easier to learn');
  if (c.why.doneBefore) w.push('you’ve done it before');
  const t = w.join(', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

describe('golden/exercises.json', () => {
  // The fixture holds the catalogue (tags, ladders, away map) but no resolveSession or candidates cases;
  // the differential tests below run the prototype's own functions over the fixture's tags instead.
  it('ladder step-ups resolve to the next step with the old exercise as a bridge', () => {
    const { ladders } = loadGolden<{ ladders: Record<string, { steps: string[][] }> }>('exercises');
    for (const L of Object.values(ladders))
      L.steps.slice(0, -1).forEach((step, i) => {
        const from = step[0] as string;
        const to = (L.steps[i + 1] as string[])[0] as string;
        expect(resolveSession([from], 'gym', st({ swaps: [swap(from, to, '2026-10-21')] }), catalog)).toEqual([{ name: to }, { name: from, bridge: true }]);
      });
  });
});

describe('ruleMatches, activeRules, isExcluded', () => {
  it('matches by exercise, family, pattern and joint', () => {
    expect(ruleMatches(rule('exercise', 'Leg Press'), 'Leg Press', tags)).toBe(true);
    expect(ruleMatches(rule('exercise', 'Leg Press'), 'Hack Squat', tags)).toBe(false);
    expect(ruleMatches(rule('family', 'squat'), 'Hack Squat', tags)).toBe(true);
    expect(ruleMatches(rule('family', 'squat'), 'Walking Lunge', tags)).toBe(false);
    expect(ruleMatches(rule('pattern', 'lunge'), 'Walking Lunge', tags)).toBe(true);
    expect(ruleMatches(rule('joint', 'knee'), 'Leg Extension', tags)).toBe(true);
    expect(ruleMatches(rule('joint', 'knee'), 'Lateral Raise', tags)).toBe(false);
  });

  it('matches untagged exercises by name only', () => {
    expect(ruleMatches(rule('exercise', 'Sled Push'), 'Sled Push', tags)).toBe(true);
    expect(ruleMatches(rule('joint', 'knee'), 'Sled Push', tags)).toBe(false);
    expect(ruleMatches({ scope: 'other' as ExclusionScope, key: 'knee' }, 'Leg Press', tags)).toBe(false);
  });

  it('skips rules brought back or deleted; adds draft rules', () => {
    const rules = [rule('exercise', 'A'), rule('exercise', 'Leg Press', { done: true }), rule('exercise', 'Hack Squat', { deleted_at: '2026-10-01T00:00:00Z' })];
    expect(activeRules(rules)).toEqual([rules[0]]);
    expect(isExcluded('Leg Press', rules, tags)).toBe(false);
    expect(isExcluded('Hack Squat', rules, tags)).toBe(false);
    expect(isExcluded('Hack Squat', rules, tags, [{ scope: 'joint', key: 'hip' }])).toBe(true);
  });
});

describe('replFromSwaps', () => {
  it('keys live swaps by source exercise', () => {
    expect(replFromSwaps([swap('A', 'B', '2026-10-20'), swap('C', 'D', null, { deleted_at: '2026-10-01T00:00:00Z' }), swap('E', 'F'), swap('E', 'G')])).toEqual({
      A: { to: 'B', bridgeUntil: '2026-10-20' },
      E: { to: 'G', bridgeUntil: null },
    });
  });

  it('feeds trimSession: a bridge stays with its replacement', () => {
    const s = st({ swaps: [swap('Hack Squat', 'Barbell Back Squat', '2026-10-21')] });
    const items = resolveSession(TEMPLATES['Legs A'] as string[], 'gym', s, catalog);
    expect(names(trimSession(items, 'Legs A', { profile: { minutes: 30 }, sessions: {}, repl: replFromSwaps(s.swaps) }))).toEqual(['Barbell Back Squat', 'Hack Squat', 'Lying Leg Curl', 'Hip Thrust']);
  });
});

describe('candidates', () => {
  const none = (name: string, o: Partial<Parameters<typeof candidates>[1]> = {}, lifts = {}, ex: Exclusion[] = []) => candidates(name, { where: 'gym', ...o }, ex, lifts, catalog);

  it('scores shared muscles, pattern and difficulty; ties keep catalogue order', () => {
    // Archer Push-ups: 10 (chest) + 2×2 (triceps, front-delt) + 6 (pattern) − 0 (same difficulty) = 20.
    // Dumbbell Bench, Incline Dumbbell: 10 + 4 + 6 − 2 = 18; Machine Chest Press: 10 + 4 + 6 − 4 = 16.
    expect(none('Barbell Bench Press').map((c) => [c.name, c.score])).toEqual([
      ['Archer Push-ups', 20],
      ['Dumbbell Bench Press', 18],
      ['Incline Dumbbell Press', 18],
    ]);
    expect(none('Barbell Bench Press', { n: 6 }).map((c) => c.name)).toEqual(['Archer Push-ups', 'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Close-Grip Bench Press', 'Decline Push-ups', 'Machine Chest Press']);
  });

  it('history adds 2; form, pain and joint change the ranking', () => {
    const find = (cs: Candidate[], n: string) => cs.find((c) => c.name === n);
    expect(find(none('Barbell Bench Press', { n: 6 }, { 'Machine Chest Press': {} }), 'Machine Chest Press')).toMatchObject({ score: 18, why: { doneBefore: true } });
    expect(none('Barbell Bench Press', { form: true })[0]).toMatchObject({ name: 'Dumbbell Bench Press', score: 24, why: { easierToLearn: true } });
    const pain = none('Barbell Bench Press', { pain: true, n: 6 });
    expect(pain[0]).toMatchObject({ name: 'Archer Push-ups', score: 16, why: { easierOnJoints: true } });
    expect(find(pain, 'Machine Chest Press')).toMatchObject({ score: 14, why: { easierOnJoints: true } });
    expect(find(pain, 'Close-Grip Bench Press')).toMatchObject({ score: 12, why: { easierOnJoints: false } });
    expect(none('Barbell Bench Press', { joint: 'shoulder', pain: true })).toEqual([
      { name: 'Dumbbell Floor Press', score: 12, why: { muscles: ['chest'], sameMovement: true, sparesJoint: 'shoulder', easierOnJoints: false, easierToLearn: false, doneBefore: false } },
    ]);
  });

  it('filters by equipment, session, exclusions and draft rules', () => {
    expect(none('Barbell Bench Press', { where: 'bodyweight' }).every((c) => tags[c.name]?.equipment === 'bodyweight')).toBe(true);
    expect(none('Barbell Bench Press', { where: 'dumbbells' }).every((c) => ['dumbbell', 'bodyweight'].includes(tags[c.name]?.equipment as string))).toBe(true);
    expect(none('Barbell Bench Press', { inSession: ['Dumbbell Bench Press'] }).map((c) => c.name)).not.toContain('Dumbbell Bench Press');
    expect(none('Barbell Bench Press', {}, {}, [rule('family', 'bench')]).map((c) => c.name)).toEqual(['Archer Push-ups', 'Decline Push-ups', 'Machine Chest Press']);
    expect(none('Barbell Bench Press', { rules: [{ scope: 'family', key: 'bench' }] }).map((c) => c.name)).toEqual(['Archer Push-ups', 'Decline Push-ups', 'Machine Chest Press']);
  });

  it('returns nothing for an untagged exercise', () => {
    expect(none('Sled Push')).toEqual([]);
  });
});

describe('resolveName and resolveSession: rules', () => {
  it('leaves names with no rule alone and follows swaps', () => {
    expect(resolveName('Leg Press', 'gym', st(), catalog)).toBe('Leg Press');
    expect(resolveName('Leg Press', 'gym', st({ swaps: [swap('Leg Press', 'Hack Squat')] }), catalog)).toBe('Hack Squat');
    expect(resolveName('A', 'gym', st({ swaps: [swap('A', 'B'), swap('B', 'C')] }), catalog)).toBe('C');
  });

  it('keeps the original when the swap target is excluded', () => {
    const s = st({ swaps: [swap('Leg Press', 'Hack Squat')], exclusions: [rule('exercise', 'Hack Squat')] });
    expect(resolveName('Leg Press', 'gym', s, catalog)).toBe('Leg Press');
  });

  it('uses the pick stored on the rule, skips on null, else the best candidate', () => {
    const pick = (to: Record<string, string | null>, more: Exclusion[] = []) => resolveName('Leg Press', 'gym', st({ exclusions: [rule('exercise', 'Leg Press', { to }), ...more] }), catalog);
    expect(pick({ 'Leg Press': 'Goblet Squat' })).toBe('Goblet Squat');
    expect(pick({ 'Leg Press': null })).toBeNull();
    expect(pick({})).toBe(candidates('Leg Press', { where: 'gym' }, [rule('exercise', 'Leg Press')], {}, catalog)[0]?.name);
    expect(pick({ 'Leg Press': 'Goblet Squat' }, [rule('exercise', 'Goblet Squat')])).toBe('Bodyweight Squat');
  });

  it('spares the joint of a joint rule and weighs joints for pain', () => {
    const r = resolveName('Leg Press', 'gym', st({ exclusions: [rule('joint', 'knee', { reason: 'pain' })] }), catalog) as string;
    expect(tags[r]?.joints).not.toContain('knee');
    expect(tags[r]?.primary).toEqual(expect.arrayContaining(['glutes']));
  });

  it('drops an excluded exercise with no tags and no pick', () => {
    expect(resolveSession(['Sled Push', 'Leg Press'], 'gym', st({ exclusions: [rule('exercise', 'Sled Push')] }), catalog)).toEqual([{ name: 'Leg Press' }]);
  });

  it('drops repeats', () => {
    expect(resolveSession(['Leg Press', 'Hack Squat'], 'gym', st({ swaps: [swap('Leg Press', 'Hack Squat')] }), catalog)).toEqual([{ name: 'Hack Squat' }]);
  });

  it('adds the bridge through its last day only, after the replacement', () => {
    const at = (date: string) => resolveSession(['Leg Press', 'Leg Extension'], 'gym', st({ date, swaps: [swap('Leg Press', 'Barbell Back Squat', '2026-10-21')] }), catalog);
    expect(at('2026-10-21')).toEqual([{ name: 'Barbell Back Squat' }, { name: 'Leg Press', bridge: true }, { name: 'Leg Extension' }]);
    expect(at('2026-10-22')).toEqual([{ name: 'Barbell Back Squat' }, { name: 'Leg Extension' }]);
  });

  it('no bridge when the old exercise is excluded or already in the session', () => {
    const s = (more: Partial<ResolveState>) => st({ swaps: [swap('Leg Press', 'Barbell Back Squat', '2026-10-21')], ...more });
    expect(resolveSession(['Leg Press'], 'gym', s({ exclusions: [rule('exercise', 'Leg Press', { to: { 'Leg Press': null } })] }), catalog)).toEqual([{ name: 'Barbell Back Squat' }]);
    expect(resolveSession(['Leg Press', 'Leg Press'], 'gym', s({}), catalog)).toEqual([{ name: 'Barbell Back Squat' }, { name: 'Leg Press', bridge: true }]);
  });

  it('a name reaching the swapped exercise through another swap still gets one bridge', () => {
    const s = st({ swaps: [swap('Hack Squat', 'Leg Press'), swap('Leg Press', 'Barbell Back Squat', '2026-10-21')] });
    expect(resolveSession(['Hack Squat', 'Leg Press'], 'gym', s, catalog)).toEqual([{ name: 'Barbell Back Squat' }, { name: 'Leg Press', bridge: true }]);
  });
});

describe('PINNED QUIRK tests', () => {
  it('PINNED QUIRK: a swap chain stops after 4 swaps; a cycle lands where the count runs out', () => {
    const chain = ['A', 'B', 'C', 'D', 'E', 'F'];
    const s = st({ swaps: chain.slice(0, -1).map((n, i) => swap(n, chain[i + 1] as string)) });
    expect(resolveName('A', 'gym', s, catalog)).toBe('E');
    expect(resolveName('A', 'gym', st({ swaps: [swap('A', 'B'), swap('B', 'C'), swap('C', 'A')] }), catalog)).toBe('B');
  });

  // Safe while the re-check card's due filter exists: #111.
  it('PINNED QUIRK: a timed rule past its `until` still applies until the user answers the re-check', () => {
    const s = st({ exclusions: [rule('exercise', 'Leg Press', { until: '2026-09-01', to: { 'Leg Press': null } })] });
    expect(resolveSession(['Leg Press'], 'gym', s, catalog)).toEqual([]);
  });

  // Spec question #109, decided: keep.
  it('PINNED QUIRK: no bridge once the swap target is itself swapped or replaced', () => {
    const s = st({ swaps: [swap('Leg Press', 'Hack Squat', '2026-10-21'), swap('Hack Squat', 'Barbell Back Squat')] });
    expect(resolveSession(['Leg Press'], 'gym', s, catalog)).toEqual([{ name: 'Barbell Back Squat' }]);
  });
});

describe('swaps and stored picks follow where you train (#109)', () => {
  it('homeName: the away version, else the name when its equipment is there, else null', () => {
    expect(homeName('Hack Squat', 'gym', catalog)).toBe('Hack Squat');
    expect(homeName('Hack Squat', 'dumbbells', catalog)).toBe('Goblet Squat');
    expect(homeName('Hack Squat', 'bodyweight', catalog)).toBe('Bodyweight Squat');
    expect(homeName('Push-ups', 'bodyweight', catalog)).toBe('Push-ups');
    expect(homeName('Barbell Row', 'dumbbells', catalog)).toBeNull(); // barbell, no away version
    expect(homeName('Lateral Raise', 'bodyweight', catalog)).toBeNull(); // away map: none at bodyweight
    expect(homeName('Sled Push', 'bodyweight', catalog)).toBe('Sled Push'); // untagged: passed through, as mapForWhere does
  });

  it('a swap target is mapped for where; with no version there the original stays', () => {
    const at = (from: string, to: string, where: Where) => resolveSession([from], where, st({ swaps: [swap(from, to)] }), catalog);
    expect(at('Dumbbell Split Squat', 'Hack Squat', 'dumbbells')).toEqual([{ name: 'Goblet Squat' }]);
    expect(at('Split Squat', 'Hack Squat', 'bodyweight')).toEqual([{ name: 'Bodyweight Squat' }]);
    expect(at('One-Arm Dumbbell Row', 'Barbell Row', 'dumbbells')).toEqual([{ name: 'One-Arm Dumbbell Row' }]);
    expect(at('One-Arm Dumbbell Row', 'Barbell Row', 'gym')).toEqual([{ name: 'Barbell Row' }]);
    expect(at('Push-ups', 'Lateral Raise', 'bodyweight')).toEqual([{ name: 'Push-ups' }]);
  });

  it('a mapped swap target that is excluded keeps the original', () => {
    const s = st({ swaps: [swap('Dumbbell Split Squat', 'Hack Squat')], exclusions: [rule('exercise', 'Goblet Squat')] });
    expect(resolveName('Dumbbell Split Squat', 'dumbbells', s, catalog)).toBe('Dumbbell Split Squat');
  });

  it('a stored pick is mapped for where; with no version there the best candidate for where is used', () => {
    const s = st({ exclusions: [rule('exercise', 'Goblet Squat', { to: { 'Goblet Squat': 'Leg Press' } })] });
    expect(resolveSession(mapForWhere(['Hack Squat'], 'dumbbells', catalog), 'dumbbells', s, catalog)).toEqual([{ name: 'Dumbbell Split Squat' }]);
    expect(resolveName('Goblet Squat', 'gym', s, catalog)).toBe('Leg Press');
    const row = st({ exclusions: [rule('exercise', 'One-Arm Dumbbell Row', { to: { 'One-Arm Dumbbell Row': 'Barbell Row' } })] });
    expect(resolveName('One-Arm Dumbbell Row', 'dumbbells', row, catalog)).toBe(candidates('One-Arm Dumbbell Row', { where: 'dumbbells' }, row.exclusions, {}, catalog)[0]?.name);
  });

  it('a stored pick is followed through swaps', () => {
    const s = st({ exclusions: [rule('exercise', 'Hack Squat', { to: { 'Hack Squat': 'Leg Press' } })], swaps: [swap('Leg Press', 'Barbell Back Squat')] });
    expect(resolveName('Hack Squat', 'gym', s, catalog)).toBe('Barbell Back Squat');
    expect(resolveName('Leg Press', 'gym', s, catalog)).toBe('Barbell Back Squat');
  });

  it('the most specific matching rule holding a pick decides it: exercise, family, pattern, then joint', () => {
    const lp = (...ex: Exclusion[]) => resolveName('Leg Press', 'gym', st({ exclusions: ex }), catalog);
    const skip = rule('exercise', 'Leg Press', { to: { 'Leg Press': null } });
    const knee = rule('joint', 'knee', { to: { 'Leg Press': 'Hip Thrust' } });
    expect(lp(knee, skip)).toBeNull();
    expect(lp(skip, knee)).toBeNull();
    const fam = rule('family', 'squat', { to: { 'Leg Press': 'Glute Bridge' } });
    expect(lp(knee, fam)).toBe('Glute Bridge');
    expect(lp(rule('pattern', 'squat', { to: { 'Leg Press': 'Hip Thrust' } }), fam)).toBe('Glute Bridge');
    // A more specific rule with no pick for this exercise leaves the broader rule's pick in force.
    expect(lp(rule('exercise', 'Leg Press'), knee)).toBe('Hip Thrust');
  });
});

describe('a replacement already in the session (#110)', () => {
  it('takes the next-best candidate not in the session, wherever that exercise sits', () => {
    const s = st({ exclusions: [rule('exercise', 'Barbell Bench Press')] });
    expect(resolveSession(['Archer Push-ups', 'Barbell Bench Press'], 'gym', s, catalog)).toEqual([{ name: 'Archer Push-ups' }, { name: 'Dumbbell Bench Press' }]);
    expect(resolveSession(['Barbell Bench Press', 'Archer Push-ups'], 'gym', s, catalog)).toEqual([{ name: 'Dumbbell Bench Press' }, { name: 'Archer Push-ups' }]);
    expect(resolveName('Barbell Bench Press', 'gym', s, catalog)).toBe('Archer Push-ups');
    expect(resolveName('Barbell Bench Press', 'gym', s, catalog, ['Archer Push-ups'])).toBe('Dumbbell Bench Press');
  });

  it('two excluded exercises do not take the same replacement', () => {
    const s = st({ exclusions: [rule('exercise', 'Barbell Bench Press'), rule('exercise', 'Archer Push-ups')] });
    const want = candidates('Barbell Bench Press', { where: 'gym' }, s.exclusions, {}, catalog)[0]?.name as string;
    const second = candidates('Machine Chest Press', { where: 'gym', inSession: [want] }, s.exclusions, {}, catalog)[0]?.name;
    expect(resolveSessionWithLost(['Barbell Bench Press', 'Machine Chest Press'], 'gym', { ...s, exclusions: [...s.exclusions, rule('exercise', 'Machine Chest Press')] }, catalog).items).toEqual([{ name: want }, { name: second }]);
  });

  it('a bridge counts as in the session', () => {
    const s = st({ swaps: [swap('Archer Push-ups', 'Push-ups', '2026-10-21')], exclusions: [rule('exercise', 'Barbell Bench Press')] });
    expect(resolveSession(['Archer Push-ups', 'Barbell Bench Press'], 'gym', s, catalog)).toEqual([{ name: 'Push-ups' }, { name: 'Archer Push-ups', bridge: true }, { name: 'Dumbbell Bench Press' }]);
  });

  it('with none left the slot stays empty and is reported as lost (the "fewer sets" note)', () => {
    const s = st({ exclusions: [rule('joint', 'shoulder', { reason: 'pain' })] });
    expect(resolveSessionWithLost(['Dumbbell Floor Press', 'Barbell Bench Press'], 'gym', s, catalog)).toEqual({ items: [{ name: 'Dumbbell Floor Press' }], lost: ['Barbell Bench Press'] });
    expect(resolveSessionWithLost(['Sled Push'], 'gym', st({ exclusions: [rule('exercise', 'Sled Push')] }), catalog)).toEqual({ items: [], lost: ['Sled Push'] });
    // A skip the user chose is not lost.
    expect(resolveSessionWithLost(['Leg Press'], 'gym', st({ exclusions: [rule('exercise', 'Leg Press', { to: { 'Leg Press': null } })] }), catalog)).toEqual({ items: [], lost: [] });
  });

  it('the prototype reports the same lost slot and shows the note in the session preview', () => {
    setProto(st({ exclusions: [rule('joint', 'shoulder', { reason: 'pain' })] }));
    const lost: string[] = [];
    expect(proto.resolveSession(['Dumbbell Floor Press', 'Barbell Bench Press'], 'gym', lost)).toEqual([{ name: 'Dumbbell Floor Press' }]);
    expect(lost).toEqual(['Barbell Bench Press']);
    expect(prototypeSource()).toContain('is left out with no replacement');
    expect(prototypeSource()).toContain('get fewer sets each week');
  });
});

describe('differential: the prototype’s own functions', () => {
  const all = Object.keys(tags);
  const CUSTOM = ['Sled Push', 'Battle Ropes'];
  const SCOPES: ExclusionScope[] = ['exercise', 'family', 'pattern', 'joint'];
  const REASONS = ['pain', 'equip', 'dislike', 'form', null] as const;

  function randomState(r: () => number): { s: ResolveState; names: string[]; where: Where } {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const pool = Array.from({ length: 6 + Math.floor(r() * 10) }, () => (r() < 0.05 ? pick(CUSTOM) : pick(all)));
    const day = (k: number) => `2026-10-${String(8 + k).padStart(2, '0')}`;
    const keyFor = (scope: ExclusionScope): string => {
      const n = pick(pool);
      const t = tags[n];
      if (scope === 'exercise' || !t) return n;
      if (scope === 'family') return t.family;
      if (scope === 'pattern') return t.pattern;
      return t.joints.length && r() < 0.95 ? pick(t.joints) : 'neck';
    };
    const exclusions: Exclusion[] = Array.from({ length: Math.floor(r() * 4) }, () => {
      const scope = pick(SCOPES);
      const to: Record<string, string | null> = {};
      for (let k = Math.floor(r() * 3); k > 0; k--) to[pick(pool)] = r() < 0.3 ? null : r() < 0.8 ? pick(pool) : pick(all);
      return rule(scope, keyFor(scope), { reason: pick(REASONS), to, done: r() < 0.15, until: r() < 0.5 ? null : day(Math.floor(r() * 20) - 10), ...(r() < 0.1 ? { deleted_at: '2026-10-01T00:00:00Z' } : {}) });
    });
    const swaps: Swap[] = Array.from({ length: Math.floor(r() * 5) }, () =>
      swap(pick(pool), pick(pool), r() < 0.4 ? null : day(Math.floor(r() * 7) - 3), r() < 0.1 ? { deleted_at: '2026-10-01T00:00:00Z' } : {}),
    );
    const lifts = Object.fromEntries(all.filter(() => r() < 0.2).map((n) => [n, { sets: [] }]));
    const names = Array.from({ length: 2 + Math.floor(r() * 7) }, () => pick(pool));
    return { s: { date: DATE, exclusions, swaps, lifts }, names, where: pick(WHERES) };
  }

  it('slices the prototype functions', () => {
    expect(typeof proto.resolveSession).toBe('function');
  });

  it('resolveSession matches the prototype over 5,000 seeded random states', () => {
    const r = rng(64);
    let bridges = 0;
    let dropped = 0;
    let lostSlots = 0;
    let nextBest = 0; // #110: an excluded name's best replacement is also another slot's exercise
    let mapped = 0; // #109: a swap target or pick changed by where
    for (let i = 0; i < 5000; i++) {
      const { s, names: ns, where } = randomState(r);
      setProto(s);
      const lost: string[] = [];
      const want = proto.resolveSession(ns, where, lost);
      const got = resolveSessionWithLost(ns, where, s, catalog);
      expect(got).toEqual({ items: want, lost });
      expect(resolveSession(ns, where, s, catalog)).toEqual(want);
      bridges += want.filter((x) => x.bridge).length;
      dropped += want.length < new Set(ns).size ? 1 : 0;
      lostSlots += lost.length;
      const alone = ns.map((n) => resolveName(n, where, s, catalog)); // each name with the session ignored
      nextBest += alone.some((a, k) => a && isExcluded(ns[k] as string, s.exclusions, tags) && alone.some((b, j) => b === a && ns[j] !== ns[k])) ? 1 : 0;
      const targets = [...s.swaps.map((w) => w.to), ...s.exclusions.flatMap((e) => Object.values(e.to))];
      mapped += where !== 'gym' && targets.some((t) => t && homeName(t, where, catalog) !== t) ? 1 : 0;
    }
    // The grid reaches the interesting branches.
    expect(bridges).toBeGreaterThan(100);
    expect(dropped).toBeGreaterThan(100);
    expect(lostSlots).toBeGreaterThan(50);
    expect(nextBest).toBeGreaterThan(20);
    expect(mapped).toBeGreaterThan(500);
  });

  it('resolveSession matches the prototype on every template, home mapping included', () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const { s, where } = randomState(r);
      for (const t of Object.keys(TEMPLATES)) {
        const ns = mapForWhere(TEMPLATES[t] as string[], where, catalog);
        setProto(s);
        const lost: string[] = [];
        const want = proto.resolveSession(ns, where, lost);
        expect(resolveSessionWithLost(ns, where, s, catalog)).toEqual({ items: want, lost });
      }
    }
  });

  it('candidates matches the prototype (order, score, why) over 3,000 seeded random calls', () => {
    const r = rng(1878);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    for (let i = 0; i < 3000; i++) {
      const { s } = randomState(r);
      const name = r() < 0.03 ? pick(CUSTOM) : pick(all);
      const inSession = all.filter(() => r() < 0.1);
      const t = tags[name];
      const joint = t && t.joints.length && r() < 0.3 ? pick(t.joints) : null;
      const draft = r() < 0.3 ? [{ scope: pick(SCOPES), key: t ? t.family : name }] : undefined;
      const o = { where: pick(WHERES), joint, pain: r() < 0.4, form: r() < 0.3, n: r() < 0.5 ? 3 : 1 + Math.floor(r() * 8) };
      setProto(s, inSession);
      const want = proto.candidates(name, { ...o, ...(draft ? { rules: draft } : {}) });
      const got = candidates(name, { ...o, inSession, ...(draft ? { rules: draft } : {}) }, s.exclusions, s.lifts || {}, catalog);
      expect(got.map((c) => ({ name: c.name, score: c.score, why: whyText(c) }))).toEqual(want);
    }
  });
});
