import { addDays } from './dates';
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
  /** Equipment available (prototype `o.where`, falling back to `whereNow()`: the day's override, else the profile's; #272). */
  where: Where;
  /**
   * Exercises already in the session, left out. Unlike the prototype, which leaves out today's workout
   * unless `ignoreSession` is set (then `o.taken`), the port leaves out nothing unless the caller lists
   * the session's names here. `resolveName` passes its `taken` names; other callers must pass today's
   * names, as the prototype's "can't do" sheet and `applyCant` rely on it.
   */
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
 * Leaves out nothing for being in the session unless `o.inSession` lists it (the prototype leaves out
 * today's workout by default). `catalog.tags` must already include custom-exercise tags (contract
 * `ExerciseTags`), merged in by the caller as prototype `applyCustomTags` does; otherwise a custom
 * exercise gets no candidates.
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

/**
 * A swap target or stored pick where the user trains: at the gym the name itself; away from it, its
 * away-map version (dumbbells or bodyweight column), else the name itself when its equipment is there
 * (or it has no tags), else `null`, meaning keep the original exercise (#109).
 *
 * Mirrors prototype `homeName(n, where)` (`AWAY` read from the catalogue's `away_map`).
 */
export function homeName(n: string, where: Where, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>): string | null {
  if (where === 'gym') return n;
  const away = catalog.away_map.dumbbells_bodyweight[n];
  const a = away ? away[where === 'dumbbells' ? 0 : 1] : n;
  if (!a) return null;
  const t = catalog.tags[a];
  return !t || (where === 'dumbbells' ? ['dumbbell', 'bodyweight'] : ['bodyweight']).includes(t.equipment) ? a : null;
}

/** Rule scopes from most to least specific (prototype `SCOPE_RANK`): a stored pick comes from the most specific rule holding one. */
export const SCOPE_RANK: Readonly<Record<ExclusionScope, number>> = { exercise: 0, family: 1, pattern: 2, joint: 3 };

/** `taken`: names left out of the candidates; `null`: return `undefined` where a candidate is needed. */
function resolveWith(
  name: string,
  where: Where,
  s: ResolveState,
  repl: Readonly<Record<string, ReplEntry>>,
  catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>,
  depth: number,
  taken: readonly string[] | null,
): string | null | undefined {
  const { tags } = catalog;
  if (depth > 3) return name;
  const excluded = (n: string) => isExcluded(n, s.exclusions, tags);
  const rp = repl[name];
  const to = rp && rp.to ? homeName(rp.to, where, catalog) : null;
  if (to && !excluded(to)) return resolveWith(to, where, s, repl, catalog, depth + 1, taken);
  if (excluded(name)) {
    const rs = activeRules(s.exclusions).filter((x) => ruleMatches(x, name, tags));
    const r = rs[0];
    const pr = [...rs].sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]).find((x) => x.to && x.to[name] !== undefined);
    const pick = pr ? pr.to[name] : undefined;
    if (pick === null) return null;
    const p = pick ? homeName(pick, where, catalog) : null;
    if (p && !excluded(p)) return resolveWith(p, where, s, repl, catalog, depth + 1, taken);
    if (taken === null) return undefined;
    const c = candidates(name, { where, joint: r && r.scope === 'joint' ? r.key : null, pain: !!r && r.reason === 'pain', inSession: taken }, s.exclusions, s.lifts || {}, catalog);
    return c[0] ? c[0].name : null;
  }
  return name;
}

/**
 * What one template exercise becomes: follows a swap whose target, mapped for `where` (`homeName`), is
 * not excluded; then, if the exercise is excluded, the pick stored under the most specific matching
 * rule that holds one (`SCOPE_RANK`; `null` = skip), mapped for `where` and followed through swaps,
 * else the best candidate leaving out `taken`, else nothing. Candidates are weighed by the first
 * matching rule (its joint, and pain). Stops after 4 steps and returns the name reached.
 *
 * Mirrors prototype `resolveName(name, where, depth, taken)`; leaving `taken` out ignores the session.
 */
export function resolveName(name: string, where: Where, state: ResolveState, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>, taken: readonly string[] = []): string | null {
  return resolveWith(name, where, state, replFromSwaps(state.swaps), catalog, 0, taken) as string | null;
}

/** A resolved session and the excluded names left out because no replacement was found. */
export interface ResolvedSession {
  items: SessionItem[];
  /**
   * Excluded exercises with no stored pick and no candidate outside the session (#110): their slot
   * stays empty. Show the "fewer sets" note for each (prototype: "<name> is left out with no
   * replacement, so your <primary muscles> get fewer sets each week.").
   */
  lost: string[];
}

/**
 * Resolves a session's names through swaps and exclusions (`resolveName`), dropping skipped names and
 * repeats. After a swap made by a ladder step, the old exercise follows its replacement as a bridge
 * item until `bridge_until`, when the swap resolved straight to its target and the old exercise is
 * not excluded.
 *
 * A replacement candidate for an excluded exercise leaves out every name already in the session: the
 * names resolved without a candidate, their bridges, and candidates picked for earlier slots (#110).
 * `catalog.tags` must already include custom-exercise tags (contract `ExerciseTags`), merged in by the
 * caller as prototype `applyCustomTags` does; otherwise a custom exercise only matches `exercise`
 * rules and gets no replacement.
 *
 * Mirrors prototype `resolveSession(names, where, lost)`, `lost` returned instead of filled in.
 */
export function resolveSessionWithLost(names: readonly string[], where: Where, state: ResolveState, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>): ResolvedSession {
  const repl = replFromSwaps(state.swaps);
  const bridged = (n: string, r: string | null | undefined): boolean => {
    const rp = repl[n];
    return !!rp && !!rp.bridgeUntil && rp.bridgeUntil >= state.date && r === rp.to && !isExcluded(n, state.exclusions, catalog.tags);
  };
  const first = names.map((n) => resolveWith(n, where, state, repl, catalog, 0, null));
  const taken: string[] = [];
  names.forEach((n, i) => {
    const f = first[i];
    if (f) taken.push(f);
    if (bridged(n, f)) taken.push(n);
  });
  const items: SessionItem[] = [];
  const lost: string[] = [];
  const seen = new Set<string>();
  names.forEach((n, i) => {
    let r = first[i];
    if (r === undefined) {
      r = resolveWith(n, where, state, repl, catalog, 0, taken);
      if (r) taken.push(r);
      else lost.push(n);
    }
    if (r && !seen.has(r)) {
      seen.add(r);
      items.push({ name: r });
    }
    if (bridged(n, r) && !seen.has(n)) {
      seen.add(n);
      items.push({ name: n, bridge: true });
    }
  });
  return { items, lost };
}

/**
 * `resolveSessionWithLost(...).items`.
 *
 * Mirrors prototype `resolveSession(names, where)`.
 */
export function resolveSession(names: readonly string[], where: Where, state: ResolveState, catalog: Pick<ExerciseCatalog, 'tags' | 'away_map'>): SessionItem[] {
  return resolveSessionWithLost(names, where, state, catalog).items;
}

/**
 * Timed rules due for the "Ready to try it again?" card: active rules (see `activeRules`) whose `until`
 * is on or before `date`. A due rule keeps applying until the user answers the card with
 * `recheckBack`, `recheckLater` or `recheckKeep`.
 *
 * Mirrors the filter in prototype `recheckCards()`.
 */
export function recheckDue(exclusions: readonly Exclusion[], date: string): Exclusion[] {
  return activeRules(exclusions).filter((r) => !!r.until && r.until <= date);
}

/** The result of "Try it again": the rule marked done, and the `Settings.returning` entries to add. */
export interface RecheckBack<R extends Exclusion> {
  rule: R;
  /** Each exercise with lift history the rule covers → its light period's last day (`date` + 13). */
  returning: Record<string, { until: string }>;
}

/**
 * "Try it again" on a re-check card: the rule is done, and every exercise with lift history it covers
 * starts at about 55% for 2 weeks (contract `Settings.returning[name].until` = `date` + 13). `liftNames`
 * are the names in prototype `S.lifts`.
 *
 * Mirrors the `rule-back` step of prototype `exAction`.
 */
export function recheckBack<R extends Exclusion>(rule: R, liftNames: readonly string[], tags: ExerciseCatalog['tags'], date: string): RecheckBack<R> {
  const returning: Record<string, { until: string }> = {};
  for (const n of liftNames) if (ruleMatches(rule, n, tags)) returning[n] = { until: addDays(date, 13) };
  return { rule: { ...rule, done: true }, returning };
}

/** "2 more weeks": the rule with `until` = `date` + 14. Mirrors the `rule-later` step of prototype `exAction`. */
export function recheckLater<R extends Exclusion>(rule: R, date: string): R {
  return { ...rule, until: addDays(date, 14) };
}

/** "Keep it out": the rule made permanent (`until` null). Mirrors the `rule-keep` step of prototype `exAction`. */
export function recheckKeep<R extends Exclusion>(rule: R): R {
  return { ...rule, until: null };
}

/** How long a "can't do" answer lasts (prototype `CX.dur`). */
export type CantDuration = 'today' | '2w' | '4w' | 'perm';

/** The "can't do" sheet's answers (prototype `CX`): scope and key default to the exercise itself. */
export interface CantDraft {
  name: string;
  reason: ExclusionReason | null;
  dur: CantDuration;
  scope?: ExclusionScope | null;
  key?: string | null;
}

/** A rule made by the "can't do" sheet, in contract `Exclusion` fields (the caller adds `id`). */
export type CantRule = Pick<Exclusion, 'name' | 'scope' | 'key' | 'reason' | 'created' | 'until' | 'to' | 'done'> & { name: string; created: string; until: string | null };

/**
 * The rule a "can't do" pick makes: scope and key from the draft (default: just this exercise), timed
 * rules checked again after 14 (`2w`) or 28 (`4w`) days, permanent otherwise, with `choice` stored as
 * the exercise's pick (`null`: skipped). For `today` the rule is not saved: it only steers today's
 * replacement (pass it as a draft rule to `candidates`). Otherwise save it and remove any swap from
 * `name` (the prototype deletes `settings.repl[name]`).
 *
 * Mirrors the rule built in prototype `applyCant(choice)`.
 */
export function cantRule(d: CantDraft, choice: string | null, date: string): CantRule {
  return {
    name: d.name,
    scope: d.scope || 'exercise',
    key: d.key || d.name,
    reason: d.reason,
    created: date,
    until: d.dur === '2w' ? addDays(date, 14) : d.dur === '4w' ? addDays(date, 28) : null,
    to: { [d.name]: choice || null },
    done: false,
  };
}

/** A scope the "can't do" sheet can leave out: `scope` with its `key` (as in `CantDraft`). */
export interface CantScope {
  scope: ExclusionScope;
  key: string;
}

/**
 * The scope the "can't do" sheet starts on for `reason`: pain leaves out the first joint the exercise
 * loads, form its whole family, anything else (or no reason, or an exercise with no tags, or pain on an
 * exercise that loads no joint) just the exercise.
 *
 * Mirrors prototype `defaultScope()` (`CX.name` and `CX.reason` passed in).
 */
export function cantDefaultScope(name: string, reason: ExclusionReason | null, tags: ExerciseCatalog['tags']): CantScope {
  const t = tags[name];
  if (!t) return { scope: 'exercise', key: name };
  if (reason === 'pain' && t.joints.length) return { scope: 'joint', key: t.joints[0] as string };
  if (reason === 'form') return { scope: 'family', key: t.family };
  return { scope: 'exercise', key: name };
}

/** One option on the "can't do" sheet's scope step. */
export interface CantScopeOption extends CantScope {
  /** For the family option: how many exercises in the whole catalog share the family (the option's "N exercises" line). Null otherwise. */
  count: number | null;
}

/**
 * The scopes the "can't do" sheet offers for `name`, in order: just the exercise; its family, only
 * when more than one exercise in the catalog (every tagged exercise, wherever you train) has it; its
 * movement pattern; then each joint it loads, in tag order. Only the exercise for an untagged name
 * (the prototype skips the scope step then). Labels are app copy (prototype `FAMILY`, `PATTERN`,
 * `JOINT`).
 *
 * Mirrors the `opts` list of the `scope` step in prototype `renderCant()`.
 */
export function cantScopeOptions(name: string, tags: ExerciseCatalog['tags']): CantScopeOption[] {
  const t = tags[name];
  const opts: CantScopeOption[] = [{ scope: 'exercise', key: name, count: null }];
  if (!t) return opts;
  const famCount = Object.values(tags).filter((x) => x.family === t.family).length;
  if (famCount > 1) opts.push({ scope: 'family', key: t.family, count: famCount });
  opts.push({ scope: 'pattern', key: t.pattern, count: null });
  for (const j of t.joints) opts.push({ scope: 'joint', key: j, count: null });
  return opts;
}

/** One replacement in today's session: the exercise at `index` becomes `to`, or is removed when `to` is null. */
export interface CantReplacement {
  index: number;
  to: string | null;
}

/**
 * Other exercises in today's session caught by a newly saved wider rule (family, pattern or joint
 * scope): each one with no ticked set, not `choice`, and covered by `rule` is replaced by its best
 * candidate (weighed by the rule's joint and pain, leaving out the session as it stands) or removed.
 * `exercises` is today's session after the tapped exercise was replaced; `exclusions` must include
 * `rule`. Returned from the last exercise to the first: apply them in that order (each index is valid
 * then). Empty for an `exercise` rule; do not call it for a `today` answer, which the prototype skips.
 *
 * Mirrors the "caught by a wider rule" loop of prototype `applyCant(choice)` (`where`: the day's
 * override, else the profile's, prototype `whereNow()`, #272).
 */
export function widerRuleReplacements(
  exercises: readonly { name: string; sets: readonly { done?: boolean }[] }[],
  rule: RuleMatch & { reason?: ExclusionReason | null },
  choice: string | null,
  where: Where,
  exclusions: readonly Exclusion[],
  lifts: Readonly<Record<string, unknown>>,
  catalog: Pick<ExerciseCatalog, 'tags'>,
): CantReplacement[] {
  if (rule.scope === 'exercise') return [];
  const names = exercises.map((e) => e.name);
  const out: CantReplacement[] = [];
  for (let k = exercises.length - 1; k >= 0; k--) {
    const ex = exercises[k] as (typeof exercises)[number];
    if (ex.name === choice || ex.sets.some((s) => s.done) || !ruleMatches(rule, ex.name, catalog.tags)) continue;
    const c = candidates(ex.name, { where, joint: rule.scope === 'joint' ? rule.key : null, pain: rule.reason === 'pain', inSession: names }, exclusions, lifts, catalog);
    const to = c[0] ? c[0].name : null;
    if (to) names[k] = to;
    else names.splice(k, 1);
    out.push({ index: k, to });
  }
  return out;
}
