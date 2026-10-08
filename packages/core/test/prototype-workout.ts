import { prototypeSource, sliceBlock, sliceLine } from './helpers';
import type { MetaTable, ShortTag } from './prototype-plan';

export interface ProtoCheckin {
  flagged: boolean;
  why: string | null;
  swap: string | null;
  good: boolean;
}

export interface ProtoWorkout {
  S: { settings: { ex?: unknown; profile?: unknown }; where: string; day: { workout: { exercises: { name: string }[] } } };
  restFor(name: string): number;
  restLabel(name: string): string;
  nextInList(t: string): string | null;
  warmupHtml(ex: unknown, i: number, sug: unknown): string;
  exInfo(name: string): { type: string; lo: number; hi: number; step: number };
  checkin(ci: unknown, nextT: string | null): ProtoCheckin;
}

/** Returns the one match of `re`'s first group in `src`, or throws (so a reshaped prototype fails loudly). */
function one(src: string, re: RegExp, what: string): string {
  const m = src.match(re);
  if (!m || m[1] === undefined) throw new Error(`prototype: ${what} changed shape`);
  return m[1];
}

/**
 * The check-in steps of prototype `renderStart()`: the `flagged` line, the `why` line, the "Swap with …"
 * condition and the "Good to go" condition, cut from the HTML and run as one function of `ci` and `nextT`.
 */
function checkinSnippet(src: string): string {
  const flaggedLine = sliceLine(src, '  const flagged = ci.sleep');
  const whyLine = sliceLine(src, '      const why = [ci.sleep');
  const swapCond = one(src, /\$\{(ci\.sore === 'very' && nextT) \? ` Or swap with/, 'swap condition');
  const goodCond = one(src, /\} else if\((ci\.[^)]*)\) h \+= `<p class="hint">Good to go\.<\/p>`;/, 'good-to-go condition');
  return [
    'function checkin(ci, nextT){',
    flaggedLine,
    '  const out = { flagged, why: null, swap: null, good: false };',
    `  if(flagged){ ${whyLine.trim()} out.why = why; out.swap = (${swapCond}) ? nextT : null; }`,
    `  else if(${goodCond}) out.good = true;`,
    '  return out;',
    '}',
  ].join('\n');
}

/**
 * Runs the prototype's rest, warm-up, next-template and check-in rules, sliced out of the HTML, against
 * a fake `S`, with `TAGS` and `EX_META` passed in. `whyLink` is stubbed to '' and `whereNow` reads `S.where`.
 */
export function loadWorkout(tags: Record<string, ShortTag>, meta: MetaTable): ProtoWorkout {
  const src = prototypeSource();
  const code = [
    'const S = { settings:{}, where:"gym", day:{ workout:{ exercises:[] } } };',
    sliceLine(src, 'const r1 = '),
    sliceLine(src, 'const DEFAULT_STEP = '),
    sliceBlock(src, 'function exInfo(name){', '}'),
    sliceLine(src, 'const noLoad = '),
    sliceLine(src, 'function snap(x, step){'),
    sliceLine(src, 'function kgLabel(w, info){'),
    sliceLine(src, 'const ORDER = '),
    sliceBlock(src, 'const SPLITS = {', '};'),
    sliceBlock(src, 'function splitFor(){', '}'),
    sliceLine(src, 'const planList = '),
    sliceLine(src, 'const nextInList = '),
    sliceLine(src, 'const COMPOUND = '),
    sliceLine(src, 'function restFor(name){'),
    sliceLine(src, 'const restLabel = '),
    sliceBlock(src, 'function warmupHtml(ex, i, sug){', '}'),
    checkinSnippet(src),
    'const whyLink = () => "", whereNow = () => S.where;',
    'return { S, restFor, restLabel, nextInList, warmupHtml, exInfo, checkin };',
  ].join('\n');
  return new Function('TAGS', 'EX_META', code)(tags, meta) as ProtoWorkout;
}
