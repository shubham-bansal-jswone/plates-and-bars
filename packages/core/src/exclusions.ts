import type { Where } from './plan';
import type { ExerciseCatalog, SessionItem } from './session';

/** What an exclusion leaves out (contract `Exclusion.scope`). */
export type ExclusionScope = 'exercise' | 'family' | 'pattern' | 'joint';

/** Why the user made the rule (contract `Exclusion.reason`). */
export type ExclusionReason = 'pain' | 'equip' | 'dislike' | 'form';

/** The fields `ruleMatches` reads: prototype `r.scope`, `r.key`. */
export interface RuleMatch {
  scope: ExclusionScope;
  key: string;
}

/**
 * An exclusion rule in the contract's `Exclusion` shape (prototype: an item in `settings.excl`).
 * Only `scope`, `key`, `reason`, `to`, `done` and `deleted_at` are read; the other contract fields are
 * accepted so contract records pass as they are. `until` is not read: a timed rule stays active after
 * it ends until the user answers the re-check card (`done`, or a new `until`), as in the prototype.
 */
export interface Exclusion extends RuleMatch {
  reason: ExclusionReason | null;
  /** Replacement picked per exercise name; `null` means skipped. */
  to: Readonly<Record<string, string | null>>;
  /** The user brought the exercise back; the rule no longer applies. */
  done: boolean;
  id?: string;
  name?: string;
  created?: string;
  until?: string | null;
  version?: number;
  updated_at?: string;
  /** A tombstone: a non-null value means the rule was removed (prototype `rule-del`). */
  deleted_at?: string | null;
}

/**
 * A lasting swap in the contract's `Swap` shape (prototype: `settings.repl[from]`). Only `from`, `to`,
 * `bridge_until` and `deleted_at` are read.
 */
export interface Swap {
  from: string;
  to: string;
  /** Last day the old exercise is kept as a bridge (prototype `bridgeUntil`). */
  bridge_until: string | null;
  id?: string;
  since?: string;
  version?: number;
  updated_at?: string;
  /** A tombstone: a non-null value means the swap was undone (prototype `repl-del`). */
  deleted_at?: string | null;
}

/** Prototype `settings.repl` value: `to` and `bridgeUntil` as stored there. */
export interface ReplEntry {
  to: string;
  bridgeUntil: string | null;
}

/**
 * Swaps keyed by the exercise they replace, the shape of prototype `settings.repl`. Swaps with
 * `deleted_at` set are left out (the prototype deletes the key); for two live swaps from the same
 * exercise (the contract allows one) the later one wins. Pass the result to `trimSession` as `repl`.
 */
export function replFromSwaps(swaps: readonly Swap[]): Record<string, ReplEntry> {
  const out: Record<string, ReplEntry> = {};
  for (const s of swaps) if (!s.deleted_at) out[s.from] = { to: s.to, bridgeUntil: s.bridge_until };
  return out;
}

/**
 * Whether a rule covers an exercise: by name for `exercise` scope, else by the exercise's family,
 * pattern or joints. Exercises without tags only match `exercise` rules.
 *
 * Mirrors prototype `ruleMatches(r, name)`.
 */
export function ruleMatches(r: RuleMatch, name: string, tags: ExerciseCatalog['tags']): boolean {
  const t = tags[name];
  if (r.scope === 'exercise') return r.key === name;
  if (!t) return false;
  if (r.scope === 'family') return t.family === r.key;
  if (r.scope === 'pattern') return t.pattern === r.key;
  if (r.scope === 'joint') return t.joints.includes(r.key);
  return false;
}

/** Rules in force: not brought back (`done`) and not deleted. Mirrors prototype `activeRules()`. */
export function activeRules(exclusions: readonly Exclusion[]): Exclusion[] {
  return exclusions.filter((r) => !r.done && !r.deleted_at);
}

/**
 * Whether any active rule, or any of `extra` (draft rules not saved yet), covers an exercise.
 *
 * Mirrors prototype `isExcluded(name, extra)`.
 */
export function isExcluded(name: string, exclusions: readonly Exclusion[], tags: ExerciseCatalog['tags'], extra?: readonly RuleMatch[]): boolean {
  return [...activeRules(exclusions), ...(extra || [])].some((r) => ruleMatches(r, name, tags));
}

/** Options for `candidates` (prototype `o`). */
export interface CandidateOptions {
  /** Equipment available (prototype `o.where`, falling back to today's workout, then gym). */
  where: Where;
  /** Exercises already in the session, left out (prototype reads today's workout unless `ignoreSession`). */
  inSession?: readonly string[];
  /** Draft rules also excluded (prototype `o.rules`). */
  rules?: readonly RuleMatch[];
  /** A joint to keep unloaded: exercises loading it are left out. */
  joint?: string | null;
  /** Reason was pain: −2 per joint loaded. */
  pain?: boolean;
  /** Reason was form: easier exercises +4, harder −6 (instead of −2 per difficulty step apart). */
  form?: boolean;
  /** How many to return; default 3. */
  n?: number;
}

/**
 * Why a candidate was suggested, as the facts behind the prototype's `why` text (the text itself is UI
 * copy built from prototype `MUSCLE`/`JOINT` labels): "works your <muscles>", then "same movement",
 * then "doesn't load the <joint>" or "easier on the joints", "easier to learn", "you've done it before".
 */
export interface CandidateWhy {
  /** Shared primary muscles, in the candidate's order. */
  muscles: string[];
  sameMovement: boolean;
  /** Set when a joint was asked to be spared. */
  sparesJoint: string | null;
  /** Pain reason, no joint given, and the candidate loads fewer joints. */
  easierOnJoints: boolean;
  /** Form reason and the candidate is less difficult. */
  easierToLearn: boolean;
  /** The user has lift history for it. */
  doneBefore: boolean;
}

/** A ranked replacement. */
export interface Candidate {
  name: string;
  score: number;
  why: CandidateWhy;
}

/**
 * Ranks replacements for an exercise: shares a primary muscle (×10 each), shared secondary +2 each,
 * same pattern +6, difficulty gap −2 per step (or the form rule), pain −2 per joint, history +2.
 * Leaves out the exercise itself, session exercises, excluded ones, ones the equipment at `where`
 * can't do, and ones loading `joint`. Ties keep catalogue order (stable sort, as the prototype's).
 *
 * Mirrors prototype `candidates(name, o)` (state passed in; `why` as facts, see `CandidateWhy`).
 */
export function candidates(
  name: string,
  o: CandidateOptions,
  exclusions: readonly Exclusion[],
  lifts: Readonly<Record<string, unknown>>,
  catalog: Pick<ExerciseCatalog, 'tags'>,
): Candidate[] {
  const { tags } = catalog;
  const t = tags[name];
  if (!t) return [];
  const allow = o.where === 'gym' ? null : o.where === 'dumbbells' ? ['dumbbell', 'bodyweight'] : ['bodyweight'];
  const inSession = new Set(o.inSession || []);
  const out: Candidate[] = [];
  for (const [c, ct] of Object.entries(tags)) {
    if (c === name || inSession.has(c) || isExcluded(c, exclusions, tags, o.rules)) continue;
    if (allow && !allow.includes(ct.equipment)) continue;
    if (o.joint && ct.joints.includes(o.joint)) continue;
    const prim = ct.primary.filter((x) => t.primary.includes(x));
    if (!prim.length) continue;
    let sc = prim.length * 10 + ct.secondary.filter((x) => t.primary.includes(x) || t.secondary.includes(x)).length * 2;
    if (ct.pattern === t.pattern) sc += 6;
    if (o.pain) sc -= ct.joints.length * 2;
    if (o.form) sc += ct.difficulty < t.difficulty ? 4 : ct.difficulty > t.difficulty ? -6 : 0;
    else sc -= Math.abs(ct.difficulty - t.difficulty) * 2;
    const done = !!lifts[c];
    if (done) sc += 2;
    out.push({
      name: c,
      score: sc,
      why: {
        muscles: prim,
        sameMovement: ct.pattern === t.pattern,
        sparesJoint: o.joint || null,
        easierOnJoints: !o.joint && !!o.pain && ct.joints.length < t.joints.length,
        easierToLearn: !!o.form && ct.difficulty < t.difficulty,
        doneBefore: done,
      },
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, o.n || 3);
}

/** What `resolveName` and `resolveSession` read from state. */
export interface ResolveState {
  /** Today, `YYYY-MM-DD` (prototype `S.date`): bridges run while `bridge_until >= date`. */
  date: string;
  exclusions: readonly Exclusion[];
  swaps: readonly Swap[];
  /** Lift history keyed by exercise (prototype `S.lifts`); only presence is read. */
  lifts?: Readonly<Record<string, unknown>>;
}

function resolveWith(name: string, where: Where, s: ResolveState, repl: Readonly<Record<string, ReplEntry>>, catalog: Pick<ExerciseCatalog, 'tags'>, depth: number): string | null {
  const { tags } = catalog;
  if (depth > 3) return name;
  const excluded = (n: string) => isExcluded(n, s.exclusions, tags);
  const rp = repl[name];
  if (rp && rp.to && !excluded(rp.to)) return resolveWith(rp.to, where, s, repl, catalog, depth + 1);
  if (excluded(name)) {
    const r = activeRules(s.exclusions).find((x) => ruleMatches(x, name, tags));
    const pick = r && r.to ? r.to[name] : undefined;
    if (pick === null) return null;
    if (pick && !excluded(pick)) return pick;
    const c = candidates(name, { where, joint: r && r.scope === 'joint' ? r.key : null, pain: !!r && r.reason === 'pain' }, s.exclusions, s.lifts || {}, catalog);
    return c[0] ? c[0].name : null;
  }
  return name;
}

/**
 * What one template exercise becomes: follows a swap (unless its target is excluded), then, if the
 * exercise is excluded, the replacement picked for it under the first matching rule (`null` = skip),
 * else the best candidate, else nothing. Stops after 4 swaps and returns the name reached.
 *
 * Mirrors prototype `resolveName(name, where, depth)`.
 */
export function resolveName(name: string, where: Where, state: ResolveState, catalog: Pick<ExerciseCatalog, 'tags'>): string | null {
  return resolveWith(name, where, state, replFromSwaps(state.swaps), catalog, 0);
}

/**
 * Resolves a session's names through swaps and exclusions (`resolveName`), dropping skipped names and
 * repeats. After a swap made by a ladder step, the old exercise follows its replacement as a bridge
 * item until `bridge_until`, when the swap resolved straight to its target and the old exercise is
 * not excluded.
 *
 * Mirrors prototype `resolveSession(names, where)`.
 */
export function resolveSession(names: readonly string[], where: Where, state: ResolveState, catalog: Pick<ExerciseCatalog, 'tags'>): SessionItem[] {
  const repl = replFromSwaps(state.swaps);
  const out: SessionItem[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const r = resolveWith(n, where, state, repl, catalog, 0);
    if (r && !seen.has(r)) {
      seen.add(r);
      out.push({ name: r });
    }
    const rp = repl[n];
    if (rp && rp.bridgeUntil && rp.bridgeUntil >= state.date && r === rp.to && !seen.has(n) && !isExcluded(n, state.exclusions, catalog.tags)) {
      seen.add(n);
      out.push({ name: n, bridge: true });
    }
  }
  return out;
}
