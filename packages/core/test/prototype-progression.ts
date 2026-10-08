import { prototypeSource, sliceBlock, sliceLine } from './helpers';
import type { MetaTable, ShortTag } from './prototype-plan';

/** Every statement in the prototype that builds `EX_META`, in source order. */
export function exMetaSource(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [sliceBlock(src, 'const EX_META = {', '};')];
  lines.forEach((l, i) => {
    if (l.startsWith("EX_META['")) out.push(l);
    if (!l.startsWith('Object.assign(EX_META, {')) return;
    if (l.endsWith('});')) return void out.push(l);
    const to = lines.findIndex((x, k) => k > i && x === '});');
    out.push(lines.slice(i, to + 1).join('\n'));
  });
  return out.join('\n');
}

/** Prototype `EX_META` as the prototype builds it (custom tags aside). */
export function prototypeExMeta(): MetaTable {
  return new Function(`${exMetaSource(prototypeSource())}\nreturn EX_META;`)() as MetaTable;
}

export interface ProtoCustomTags {
  S: { settings: { customTags?: Record<string, ShortTag> } };
  TAGS: Record<string, ShortTag>;
  EX_META: MetaTable;
  applyCustomTags(): void;
}

/** Runs prototype `applyCustomTags()`, sliced out of the HTML, on the `TAGS` and `EX_META` passed in (it mutates them). */
type CustomTagsFn = (tags: Record<string, ShortTag>, meta: MetaTable) => ProtoCustomTags;
let customTagsFn: CustomTagsFn | null = null;
export function loadCustomTags(tags: Record<string, ShortTag>, meta: MetaTable): ProtoCustomTags {
  if (!customTagsFn) {
    const code = ['const S = { settings:{} };', sliceLine(prototypeSource(), 'function applyCustomTags(){'), 'return { S, TAGS, EX_META, applyCustomTags };'].join('\n');
    customTagsFn = new Function('TAGS', 'EX_META', code) as CustomTagsFn;
  }
  return customTagsFn(tags, meta);
}

export interface ProgState {
  date: string;
  lifts: Record<string, unknown>;
  settings: { ex?: Record<string, unknown>; returning?: Record<string, unknown>; profile?: unknown };
  day: { workout: { exercises: unknown[]; mods?: unknown } };
  where: string;
}

export interface ProtoProgression {
  S: ProgState;
  suggestBase(ex: unknown): unknown;
  suggestFor(ex: unknown): unknown;
  setTarget(ex: unknown, j: number, sug: unknown): unknown;
  workoutAction(a: string, b: { dataset: Record<string, string> }): void;
  toasts: string[];
}

/**
 * Runs the prototype's own weight-guidance functions and its `workoutAction` handler, sliced out of
 * the HTML, against a fake `S`, with `EX_META` passed in. UI calls (`saveDay`, `render`, `toast`,
 * `startRest`, `updateLift`) are stubbed; toasts are recorded.
 */
export function loadProgression(meta: MetaTable): ProtoProgression {
  const src = prototypeSource();
  const code = [
    'const S = { date:"", lifts:{}, settings:{}, day:{ workout:{ exercises:[] } }, where:"gym" };',
    'const toasts = [];',
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const r1 = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const older = '),
    sliceLine(src, 'const DEFAULT_STEP = '),
    sliceLine(src, 'const RATES = '),
    sliceBlock(src, 'function exInfo(name){', '}'),
    sliceLine(src, 'const noLoad = '),
    sliceLine(src, 'const repWord = '),
    sliceLine(src, 'function snap(x, step){'),
    sliceLine(src, 'function harder(w, info){'),
    sliceBlock(src, 'function easier(w, info, pct){', '}'),
    sliceLine(src, 'function kgLabel(w, info){'),
    sliceBlock(src, 'function lastFor(name){', '}'),
    sliceLine(src, 'function prevOf(name, last){'),
    sliceLine(src, 'function suggestFor(ex){'),
    sliceBlock(src, 'function suggestBase(ex){', '}'),
    sliceLine(src, 'function kgLabelShort(w, info){'),
    sliceBlock(src, 'function setTarget(ex, j, sug){', '}'),
    sliceBlock(src, 'function applyMods(sug, ex){', '}'),
    sliceBlock(src, 'function workoutAction(a, b){', '}'),
    'const whereNow = () => S.where;',
    'const saveDay = () => {}, render = () => {}, startRest = () => {}, updateLift = () => {}, toast = m => toasts.push(m);',
    'return { S, suggestBase, suggestFor, setTarget, workoutAction, toasts };',
  ].join('\n');
  return new Function('EX_META', code)(meta) as ProtoProgression;
}
