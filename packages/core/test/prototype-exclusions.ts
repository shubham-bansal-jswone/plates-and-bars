import { loadGolden, prototypeSource, sliceBlock, sliceLine } from './helpers';

/** An exclusion as the prototype stores it in `settings.excl`. */
export interface ProtoRule {
  scope: string;
  key: string;
  reason: string | null;
  to: Record<string, string | null>;
  done: boolean;
}

/** A swap as the prototype stores it in `settings.repl[from]`. */
export interface ProtoRepl {
  to: string;
  bridgeUntil: string | null;
}

export interface ProtoExclState {
  date: string;
  settings: { excl: ProtoRule[]; repl: Record<string, ProtoRepl> };
  lifts: Record<string, unknown>;
  day: { workout: { where?: string; exercises: { name: string }[] } };
}

export interface ProtoCandidate {
  name: string;
  score: number;
  why: string;
}

export interface ProtoExclusions {
  S: ProtoExclState;
  resolveSession(names: string[], where: string): { name: string; bridge?: boolean }[];
  resolveName(name: string, where: string): string | null;
  candidates(name: string, o: Record<string, unknown>): ProtoCandidate[];
  isExcluded(name: string, extra?: unknown[]): boolean;
  MUSCLE: Record<string, string>;
  JOINT: Record<string, string>;
  listJoin(a: string[]): string;
}

/**
 * Runs the prototype's own exclusion and swap functions (`ruleMatches`, `activeRules`, `isExcluded`,
 * `candidates`, `resolveName`, `resolveSession`), sliced out of the HTML, against a fake `S`, with
 * `TAGS` from golden/exercises.json as the prototype holds it (short tag names). Nothing is stubbed.
 */
export function loadExclusions(): ProtoExclusions {
  const tags = loadGolden<{ tags: Record<string, unknown> }>('exercises').tags;
  const src = prototypeSource();
  const code = [
    'const S = { date:"", settings:{ excl:[], repl:{} }, lifts:{}, day:{ workout:{ exercises:[] } } };',
    sliceLine(src, 'const MUSCLE = '),
    sliceLine(src, 'const JOINT = '),
    sliceLine(src, 'const ruleState = '),
    sliceBlock(src, 'function ruleMatches(r, name){', '}'),
    sliceLine(src, 'const activeRules = '),
    sliceLine(src, 'const isExcluded = '),
    sliceLine(src, 'const listJoin = '),
    sliceBlock(src, 'function candidates(name, o = {}){', '}'),
    sliceBlock(src, 'function resolveName(name, where, depth = 0){', '}'),
    sliceBlock(src, 'function resolveSession(names, where){', '}'),
    'return { S, resolveSession, resolveName, candidates, isExcluded, MUSCLE, JOINT, listJoin };',
  ].join('\n');
  return new Function('TAGS', code)(tags) as ProtoExclusions;
}
