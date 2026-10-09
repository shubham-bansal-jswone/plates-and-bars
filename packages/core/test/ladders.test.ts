import content from '../../../content/exercises.json';
import {
  addDays,
  candidates,
  cantRule,
  estimateFor,
  ESTIMATE_PAIRS,
  exInfo,
  ladderCard,
  ladderOf,
  ladderStayUntil,
  ladderSwap,
  nextStep,
  overridesFromSettings,
  prevStep,
  recheckBack,
  recheckDue,
  recheckKeep,
  recheckLater,
  resolveName,
  sidewaysOf,
  stallRangeOverride,
  widerRuleReplacements,
  type CantDraft,
  type CantDuration,
  type Exclusion,
  type ExclusionReason,
  type ExclusionScope,
  type ExerciseTag,
  type ExerciseOverride,
  type LadderCard,
  type LadderCatalog,
  type LiftRecord,
  type Rate,
  type SettingsExerciseOverride,
  type Where,
} from '../src/index';
import { loadGolden } from './helpers';
import { metaTable, rng } from './prototype-plan';
import { loadLadders, type ProtoExercise, type ProtoRule } from './prototype-ladders';
import { loadStalls } from './prototype-stalls';

// golden/exercises.json holds the ladders but no ladder-card, re-check or "can't do" cases; these rules
// are checked against the prototype's own functions over random inputs, and by hand-worked unit tests.
const catalog = content as unknown as LadderCatalog & typeof content;
const { tags } = catalog;
const DATE = '2026-10-08';
const WHERES: Where[] = ['gym', 'dumbbells', 'bodyweight'];
const SCOPES: ExclusionScope[] = ['exercise', 'family', 'pattern', 'joint'];
const REASONS: (ExclusionReason | null)[] = ['pain', 'equip', 'dislike', 'form', null];
const RATES: (Rate | null)[] = [null, 'easy', 'right', 'hard', 'fail'];
const NAMES = Object.keys(tags);
const LADDER_NAMES = Object.values(catalog.ladders).flatMap((l) => l.steps.flat());

const proto = loadLadders(metaTable(catalog.meta));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rule = (scope: ExclusionScope, key: string, more: Partial<Exclusion> = {}): Exclusion => ({ scope, key, reason: null, to: {}, done: false, until: null, ...more });

function unesc(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The facts behind the prototype's ladder-card HTML. */
function parseCard(html: string): LadderCard | null {
  if (!html) return null;
  const key = unesc((/data-key="([^"]*)"/.exec(html) as RegExpExecArray)[1] as string);
  const d = /Step down to (.*?) for a few weeks\?<\/b><p>The last two sessions had (form breaking down|failed sets)\./.exec(html);
  if (d) return { kind: 'down', key, to: unesc(d[1] as string), because: d[2] === 'failed sets' ? 'fail' : 'form' };
  const u = /<b>Ready to try (.*?)\?<\/b>[\s\S]*?for (\d+) sessions/.exec(html);
  if (!u) throw new Error(`unknown card: ${html}`);
  return { kind: 'up', key, to: unesc(u[1] as string), sessions: Number(u[2]) };
}

function setProto(more: Partial<typeof proto.S> = {}, settings: Partial<typeof proto.S.settings> = {}): void {
  Object.assign(proto.S, { date: DATE, where: 'gym', lifts: {}, day: { workout: { exercises: [] } }, ...more });
  proto.S.settings = { excl: [], repl: {}, returning: {}, ladderStay: {}, adj: {}, ex: {}, ...settings };
}

function randRules(r: () => number, n: number, pick: <T>(xs: readonly T[]) => T): Exclusion[] {
  return Array.from({ length: n }, (_, k) => {
    const name = pick(NAMES);
    const t = tags[name as keyof typeof tags] as ExerciseTag;
    const scope = pick(SCOPES);
    const key = scope === 'exercise' ? name : scope === 'family' ? t.family : scope === 'pattern' ? t.pattern : (pick(t.joints.length ? t.joints : ['knee']) as string);
    return rule(scope, key, { id: `r${k}`, reason: pick(REASONS), done: r() < 0.2, until: pick([null, addDays(DATE, -3), DATE, addDays(DATE, 1)]) });
  });
}

const toProtoRules = (xs: readonly Exclusion[]): ProtoRule[] => xs.map((x) => clone({ id: x.id as string, scope: x.scope, key: x.key, reason: x.reason, until: x.until ?? null, to: x.to, done: x.done }));

describe('content ladders', () => {
  it('content/exercises.json ladders equal golden/exercises.json ladders (prototype LADDERS)', () => {
    expect(catalog.ladders).toEqual(loadGolden<{ ladders: unknown }>('exercises').ladders);
  });
});

describe('ladderOf, nextStep, prevStep, sidewaysOf', () => {
  it('finds the ladder and step; steps skip excluded exercises', () => {
    expect(ladderOf('Leg Press', catalog.ladders)).toMatchObject({ key: 'squat', label: 'Squat', i: 2 });
    expect(ladderOf('Cable Crunch', catalog.ladders)).toBeNull();
    expect(nextStep('Dumbbell Split Squat', [], catalog)).toBe('Hack Squat');
    expect(nextStep('Dumbbell Split Squat', [rule('exercise', 'Hack Squat')], catalog)).toBe('Leg Press');
    expect(nextStep('Barbell Back Squat', [], catalog)).toBeNull();
    expect(prevStep('Goblet Squat', [], catalog)).toBeNull();
    expect(prevStep('Barbell Back Squat', [rule('exercise', 'Hack Squat'), rule('exercise', 'Leg Press')], catalog)).toBeNull();
    expect(sidewaysOf('Hack Squat', [], catalog)).toBe('Leg Press');
    expect(sidewaysOf('Not An Exercise', [], catalog)).toBeNull();
  });

  it('PINNED QUIRK (#262): sidewaysOf ignores where the user trains, so at home it can offer a gym-only exercise', () => {
    const side = sidewaysOf('Lateral Raise', [], catalog) as string;
    expect(side).toBe('Cable Lateral Raise');
    // saved as a swap, it resolves back to the exercise itself at home: the button changes nothing
    const swap = { ...ladderSwap('side', 'Lateral Raise', side, DATE) };
    expect(resolveName('Lateral Raise', 'dumbbells', { date: DATE, exclusions: [], swaps: [swap] }, catalog)).toBe('Lateral Raise');
  });

  it('match the prototype for every catalogue exercise under 300 random rule sets', () => {
    const r = rng(111);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    for (let k = 0; k < 300; k++) {
      const excl = randRules(r, Math.floor(r() * 4), pick);
      setProto({}, { excl: toProtoRules(excl) });
      for (const n of [...NAMES, 'Not An Exercise']) {
        const want = proto.ladderOf(n);
        expect(ladderOf(n, catalog.ladders)).toEqual(want);
        expect(nextStep(n, excl, catalog)).toBe(proto.nextStep(n));
        expect(prevStep(n, excl, catalog)).toBe(proto.prevStep(n));
        expect(sidewaysOf(n, excl, catalog)).toBe(proto.sidewaysOf(n));
      }
    }
  });
});

describe('estimateFor', () => {
  it('scales the top weight of the first pair with history, snapped, at least one step', () => {
    const info = exInfo('Barbell Bench Press', catalog);
    expect(estimateFor('Barbell Bench Press', { 'Dumbbell Bench Press': { sets: [{ w: 20, r: 10 }, { w: 22.5, r: 8 }] } }, info)).toEqual({ from: 'Dumbbell Bench Press', fromW: 22.5, w: 50 });
    // falls through a pair whose source has no weight
    expect(estimateFor('Barbell Bench Press', { 'Dumbbell Bench Press': { sets: [{ w: 0, r: 10 }] }, 'Incline Dumbbell Press': { sets: [{ w: 10, r: 10 }] } }, info)).toEqual({ from: 'Incline Dumbbell Press', fromW: 10, w: 25 });
    expect(estimateFor('Barbell Bench Press', { 'Dumbbell Bench Press': { sets: [] } }, info)).toBeNull();
    expect(estimateFor('Leg Press', {}, exInfo('Leg Press', catalog))).toBeNull();
    // step 0 snaps to 2.5 and is at least 2.5
    expect(estimateFor('One-Arm Dumbbell Row', { 'Barbell Row': { sets: [{ w: 1, r: 8 }] } }, { type: 'bodyweight', lo: 8, hi: 12, step: 0 })).toEqual({ from: 'Barbell Row', fromW: 1, w: 2.5 });
  });

  it('matches the prototype on 3,000 random histories', () => {
    const r = rng(7);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const targets = [...new Set(ESTIMATE_PAIRS.map((p) => p.to)), 'Leg Press'];
    const sources = [...new Set(ESTIMATE_PAIRS.map((p) => p.from))];
    let found = 0;
    for (let k = 0; k < 3000; k++) {
      const lifts: Record<string, Pick<LiftRecord, 'date' | 'sets'>> = {};
      for (const s of sources) if (r() < 0.4) lifts[s] = { date: '2026-10-01', sets: Array.from({ length: Math.floor(r() * 3) }, () => ({ w: pick([0, 7.5, 10, 22.5, 41.3, 60, 102.5]), r: 8 })) };
      const name = pick(targets);
      const where = pick(WHERES);
      const ov: ExerciseOverride | undefined = r() < 0.3 ? { step: pick([0, 1, 1.25, 5]) } : undefined;
      setProto({ lifts: clone(lifts), where }, { ex: ov ? { [name]: ov } : {} });
      const got = estimateFor(name, lifts, exInfo(name, catalog, ov, where));
      expect(got).toEqual(proto.estimateFor(name));
      if (got) found++;
    }
    expect(found).toBeGreaterThan(500);
  });
});

describe('ladderCard', () => {
  const L = (more: Partial<LiftRecord> = {}): LiftRecord => ({ date: '2026-10-01', sets: [{ w: 60, r: 12 }, { w: 60, r: 12 }], n: 4, form: 'yes', ...more });
  const info = exInfo('Dumbbell Split Squat', catalog);
  const ex = { name: 'Dumbbell Split Squat', sets: [{ done: false }] };
  const st = { date: DATE, exclusions: [] };

  it('step up after 4 sessions at the top of the range with solid form', () => {
    const lifts = { [ex.name]: L({ sets: [{ w: 20, r: info.hi }] }) };
    expect(ladderCard(ex, lifts, info, st, catalog)).toEqual({ kind: 'up', key: 'up:Dumbbell Split Squat:2026-10-01', to: 'Hack Squat', sessions: 4 });
    expect(ladderCard(ex, { [ex.name]: L({ sets: [{ w: 20, r: info.hi }], n: 3 }) }, info, st, catalog)).toBeNull();
    expect(ladderCard(ex, { [ex.name]: L({ sets: [{ w: 20, r: info.hi, rate: 'hard' }] }) }, info, st, catalog)).toBeNull();
    expect(ladderCard(ex, lifts, info, { ...st, ladderStay: { [ex.name]: DATE } }, catalog)).toBeNull();
    expect(ladderCard(ex, lifts, info, { ...st, ladderStay: { [ex.name]: addDays(DATE, -1) } }, catalog)).not.toBeNull();
    expect(ladderCard(ex, lifts, info, { ...st, adj: { dismissed: { 'up:Dumbbell Split Squat:2026-10-01': true } } }, catalog)).toBeNull();
    expect(ladderCard(ex, lifts, info, { ...st, adj: { muted: { ladder: true } } }, catalog)).toBeNull();
    expect(ladderCard({ ...ex, sets: [{ done: true }] }, lifts, info, st, catalog)).toBeNull();
    expect(ladderCard(ex, {}, info, st, catalog)).toBeNull();
  });

  it('step down after two bad sessions, even when a stay answer covers today', () => {
    const lifts = { [ex.name]: L({ form: 'no', prev: { date: '2026-09-28', sets: [{ w: 20, r: 5, rate: 'fail' }] } }) };
    expect(ladderCard(ex, lifts, info, { ...st, ladderStay: { [ex.name]: DATE } }, catalog)).toEqual({ kind: 'down', key: 'down:Dumbbell Split Squat:2026-10-01', to: 'Goblet Squat', because: 'form' });
    const fail = { [ex.name]: L({ sets: [{ w: 20, r: 5, rate: 'fail' }], prev: { date: '2026-09-28', sets: [], form: 'no' } }) };
    expect(ladderCard(ex, fail, info, st, catalog)).toMatchObject({ kind: 'down', because: 'fail' });
    expect(ladderCard(ex, fail, info, { ...st, adj: { dismissed: { 'down:Dumbbell Split Squat:2026-10-01': true } } }, catalog)).toBeNull();
  });

  it('matches the prototype on 20,000 random records', () => {
    const r = rng(2026);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const counts = { up: 0, down: 0, none: 0 };
    for (let k = 0; k < 20000; k++) {
      const name = r() < 0.9 ? pick(LADDER_NAMES) : pick(NAMES);
      const where = pick(WHERES);
      const ov: ExerciseOverride | undefined = r() < 0.2 ? { lo: 5, hi: pick([8, 10]) } : undefined;
      const info = exInfo(name, catalog, ov, where);
      const sess = () => ({
        sets: Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ w: 20, r: info.hi - (r() < 0.75 ? 0 : 1), rate: r() < 0.6 ? null : pick(RATES) })),
        form: pick(['yes', 'no', null, null, null] as const),
      });
      const date = pick(['2026-10-01', '2026-10-05']);
      const rec: LiftRecord = { date, ...sess(), n: pick([0, 2, 4, 4, 5, 9]), ...(r() < 0.7 ? { prev: { date: '2026-09-28', ...sess() } } : {}) };
      const lifts = r() < 0.95 ? { [name]: rec } : {};
      const excl = randRules(r, r() < 0.6 ? 0 : 2, pick);
      const stay = r() < 0.2 ? { [name]: pick([addDays(DATE, -1), DATE, addDays(DATE, 30)]) } : {};
      const dismissKey = `${pick(['up', 'down'])}:${name}:${date}`;
      const adj = { muted: r() < 0.05 ? { ladder: true } : {}, dismissed: r() < 0.1 ? { [dismissKey]: true } : {} };
      const ex: ProtoExercise = { name, sets: [{ w: '', r: '', done: r() < 0.05 }] };
      setProto({ lifts: clone(lifts), where }, { excl: toProtoRules(excl), ladderStay: { ...stay }, adj: clone(adj), ex: ov ? { [name]: ov } : {} });
      const got = ladderCard(ex, lifts, info, { date: DATE, exclusions: excl, ladderStay: stay, adj }, catalog);
      expect(got).toEqual(parseCard(proto.ladderCard(ex)));
      counts[got ? got.kind : 'none']++;
    }
    expect(counts.up).toBeGreaterThan(500);
    expect(counts.down).toBeGreaterThan(500);
  });
});

describe('ladder and stall card buttons', () => {
  it('match the prototype exAction steps', () => {
    setProto();
    proto.exAction('ladder-up', { dataset: { v: 'Hack Squat', name: 'Goblet Squat', key: 'k' } });
    proto.exAction('ladder-down', { dataset: { v: 'Goblet Squat', name: 'Leg Press', key: 'k' } });
    proto.exAction('swap-side', { dataset: { v: 'Leg Press', name: 'Hack Squat', key: 'k' } });
    proto.exAction('ladder-stay', { dataset: { v: 'Barbell Back Squat', name: 'Hack Squat', key: 'k' } });
    const repl = (s: { from: string; to: string; since: string; bridge_until: string | null }) => ({ to: s.to, ...(s.bridge_until ? { bridgeUntil: s.bridge_until } : {}), since: s.since });
    expect(proto.S.settings.repl).toEqual({
      'Goblet Squat': repl(ladderSwap('up', 'Goblet Squat', 'Hack Squat', DATE)),
      'Leg Press': repl(ladderSwap('down', 'Leg Press', 'Goblet Squat', DATE)),
      'Hack Squat': repl(ladderSwap('side', 'Hack Squat', 'Leg Press', DATE)),
    });
    expect(ladderSwap('up', 'a', 'b', DATE)).toEqual({ from: 'a', to: 'b', since: DATE, bridge_until: '2026-10-21' });
    expect(proto.S.settings.ladderStay).toEqual({ 'Hack Squat': ladderStayUntil(DATE) });
    expect(ladderStayUntil(DATE)).toBe('2026-11-19');
  });

  it('stallRangeOverride: the contract entry for the stall card range, as adjAction("adj-range") merges it (#128)', () => {
    const info = { type: 'machine' as const, lo: 10, hi: 15, step: 1 };
    expect(stallRangeOverride({ type: 'cable', step_kg: 2, rep_low: 10, rep_high: 15 }, info, [6, 8])).toEqual({ type: 'machine', step_kg: 1, rep_low: 6, rep_high: 8 });
    expect(stallRangeOverride(null, info, [10, 12])).toEqual({ type: 'machine', step_kg: 1, rep_low: 10, rep_high: 12 });

    const stalls = loadStalls(metaTable(catalog.meta));
    const r = rng(128);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    for (let k = 0; k < 500; k++) {
      const name = pick(NAMES);
      const where = pick(WHERES);
      const existing: SettingsExerciseOverride | undefined = r() < 0.5 ? { type: pick(['barbell', 'cable', 'other']), step_kg: pick([0, 1, 2.5]), rep_low: pick([5, 8]), rep_high: pick([10, 12]) } : undefined;
      const ov = existing ? overridesFromSettings({ [name]: existing }) : {};
      const inf = exInfo(name, catalog, ov[name], where);
      const range = pick([[6, 8], [10, 12]] as const);
      Object.assign(stalls.S, { date: DATE, where, settings: { ex: clone(ov), adj: {} } });
      stalls.adjAction('adj-range', { dataset: { type: 'stall', key: 'k', name, v: range.join('-') } });
      const want = (stalls.S.settings.ex as Record<string, ExerciseOverride>)[name];
      expect(overridesFromSettings({ [name]: stallRangeOverride(existing, inf, range) })[name]).toEqual(want);
    }
  });
});

describe('re-check cards', () => {
  const pain = rule('joint', 'knee', { id: 'a', reason: 'pain', until: DATE, to: { 'Leg Press': 'Leg Curl' } });

  it('recheckDue: active timed rules whose until has come', () => {
    const rules = [pain, rule('exercise', 'Leg Press', { id: 'b', until: addDays(DATE, 1) }), rule('exercise', 'Hack Squat', { id: 'c' }), rule('exercise', 'Deadlift', { id: 'd', until: DATE, done: true }), rule('exercise', 'Deadlift', { id: 'e', until: DATE, deleted_at: '2026-10-01T00:00:00Z' })];
    expect(recheckDue(rules, DATE).map((x) => x.id)).toEqual(['a']);
  });

  it('answers: try again (with returning lifts), 2 more weeks, keep it out', () => {
    expect(recheckBack(pain, ['Leg Press', 'Lat Pulldown', 'Not tagged'], tags, DATE)).toEqual({ rule: { ...pain, done: true }, returning: { 'Leg Press': { until: '2026-10-21' } } });
    expect(recheckLater(pain, DATE)).toEqual({ ...pain, until: '2026-10-22' });
    expect(recheckKeep(pain)).toEqual({ ...pain, until: null });
  });

  it('match the prototype on 2,000 random rule sets', () => {
    const r = rng(42);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    for (let k = 0; k < 2000; k++) {
      const excl = randRules(r, 1 + Math.floor(r() * 5), pick);
      const liftNames = NAMES.filter(() => r() < 0.1);
      const lifts = Object.fromEntries(liftNames.map((n) => [n, {}]));
      setProto({ lifts }, { excl: toProtoRules(excl) });
      const ids = [...proto.recheckCards().matchAll(/data-act="rule-back" data-v="([^"]*)"/g)].map((m) => m[1]);
      expect(recheckDue(excl, DATE).map((x) => x.id)).toEqual(ids);

      const target = pick(excl);
      const act = pick(['rule-back', 'rule-later', 'rule-keep']);
      proto.exAction(act, { dataset: { v: target.id as string } });
      const got = act === 'rule-back' ? recheckBack(target, liftNames, tags, DATE) : { rule: act === 'rule-later' ? recheckLater(target, DATE) : recheckKeep(target), returning: {} };
      const after = excl.map((x) => (x === target ? got.rule : x));
      expect(proto.S.settings.excl).toEqual(toProtoRules(after));
      expect(proto.S.settings.returning).toEqual(got.returning);
    }
  });
});

describe("can't do: the rule and the wider-rule replacements", () => {
  it('cantRule: scope defaults to the exercise; 2w and 4w are timed, others permanent', () => {
    const d: CantDraft = { name: 'Leg Press', reason: 'pain', dur: '2w' };
    expect(cantRule(d, 'Leg Curl', DATE)).toEqual({ name: 'Leg Press', scope: 'exercise', key: 'Leg Press', reason: 'pain', created: DATE, until: '2026-10-22', to: { 'Leg Press': 'Leg Curl' }, done: false });
    expect(cantRule({ ...d, dur: '4w', scope: 'joint', key: 'knee' }, null, DATE)).toMatchObject({ scope: 'joint', key: 'knee', until: '2026-11-05', to: { 'Leg Press': null } });
    expect(cantRule({ ...d, dur: 'perm' }, '', DATE).until).toBeNull();
  });

  it('widerRuleReplacements: none for an exercise rule; skips ticked exercises and the pick', () => {
    const r = rule('exercise', 'Leg Press');
    expect(widerRuleReplacements([{ name: 'Leg Press', sets: [] }], r, null, 'gym', [r], {}, catalog)).toEqual([]);
    const knee = rule('joint', 'knee', { reason: 'pain' });
    const session = [
      { name: 'Leg Curl', sets: [{ done: false }] },
      { name: 'Hack Squat', sets: [{ done: true }] },
      { name: 'Leg Press', sets: [{ done: false }] },
      { name: 'Goblet Squat', sets: [{ done: false }] },
    ];
    const steps = widerRuleReplacements(session, knee, 'Goblet Squat', 'gym', [knee], {}, catalog);
    expect(steps.map((s) => s.index)).toEqual([2]);
    const c = candidates('Leg Press', { where: 'gym', joint: 'knee', pain: true, inSession: session.map((s) => s.name) }, [knee], {}, catalog);
    expect(steps[0]?.to).toBe(c[0] ? c[0].name : null);
  });

  /** Prototype `replaceAt` on names: keep ticked sets and add the pick after, else replace or remove. */
  function replaceAt(list: { name: string; done: boolean }[], idx: number, pick: string | null): void {
    const ex = list[idx] as { name: string; done: boolean };
    if (ex.done) {
      if (pick) list.splice(idx + 1, 0, { name: pick, done: false });
    } else if (pick) list.splice(idx, 1, { name: pick, done: false });
    else list.splice(idx, 1);
  }

  it('matches prototype applyCant on 3,000 random sessions', () => {
    const r = rng(9);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    let replaced = 0;
    for (let k = 0; k < 3000; k++) {
      const where = pick(WHERES);
      const names = [...new Set(Array.from({ length: 6 }, () => pick(NAMES)))];
      const session = names.map((name) => ({ name, done: r() < 0.2 }));
      const i = r() < 0.85 ? Math.floor(r() * session.length) : null;
      const name = i === null ? pick(NAMES) : (session[i] as { name: string }).name;
      const t = tags[name as keyof typeof tags] as ExerciseTag;
      const dur: CantDuration = pick(i === null ? (['2w', '4w', 'perm'] as const) : (['today', '2w', '4w', 'perm'] as const));
      const opts: [ExclusionScope, string][] = [['exercise', name], ['family', t.family], ['pattern', t.pattern], ...t.joints.map((j) => ['joint', j] as [ExclusionScope, string])];
      const [scope, key] = dur === 'today' ? (['exercise', name] as const) : r() < 0.1 ? (['', ''] as const) : pick(opts);
      const reason = pick(REASONS.slice(0, 4)) as ExclusionReason;
      const existing = randRules(r, Math.floor(r() * 2), pick).map((x) => ({ ...x, until: null }));
      const lifts = Object.fromEntries(NAMES.filter(() => r() < 0.05).map((n) => [n, { date: '2026-10-01', sets: [{ w: 10, r: 8 }] }]));
      const draft: CantDraft = { name, reason, dur, scope: (scope || null) as ExclusionScope | null, key: key || null };
      const draftRule = { scope: (scope || 'exercise') as ExclusionScope, key: key || name, reason };
      const cands = candidates(name, { where, rules: [draftRule], joint: draftRule.scope === 'joint' ? draftRule.key : null, pain: reason === 'pain', form: reason === 'form', inSession: i === null ? [] : names }, existing, lifts, catalog);
      const choice = r() < 0.2 ? null : cands[0] ? pick(cands).name : null;

      setProto({ lifts: clone(lifts), day: { workout: { where, exercises: session.map((s) => ({ name: s.name, sets: [{ w: '1', r: '1', done: s.done }, { w: '', r: '', done: false }] })) } } }, { excl: toProtoRules(existing) });
      Object.assign(proto.CX, { i, name, step: 'pick', reason, dur, scope, key });
      proto.applyCant(choice);

      const made = cantRule(draft, choice, DATE);
      const today = dur === 'today';
      const exclusions = today ? existing : [...existing, { ...made, id: `new${k}` }];
      const { done: _done, ...madeProto } = made; // the prototype's rule has no done field
      const after = proto.S.settings.excl.map(({ id: _id, ...x }) => x);
      expect(after).toEqual([...toProtoRules(existing).map(({ id: _id, ...x }) => x), ...(today ? [] : [madeProto])]);

      const list = session.map((s) => ({ ...s }));
      if (i !== null) replaceAt(list, i, choice);
      if (!today) {
        const ex = list.map((s) => ({ name: s.name, sets: [{ done: s.done }] }));
        for (const step of widerRuleReplacements(ex, made, choice, where, exclusions, lifts, catalog)) {
          replaceAt(list, step.index, step.to);
          replaced++;
        }
      }
      expect(proto.S.day.workout.exercises.map((e) => ({ name: e.name, done: e.sets.some((s) => s.done) }))).toEqual(list);
    }
    expect(replaced).toBeGreaterThan(300);
  });
});
