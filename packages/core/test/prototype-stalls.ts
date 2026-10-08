import type { ExerciseMetaTable } from '../src/index';
import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoStalls {
  S: { date: string; lifts: Record<string, unknown>; settings: { adj?: unknown; ex?: unknown }; where: string };
  toasts: string[];
  sessionScore(sets: unknown, type: string): number;
  stalled(name: string): boolean;
  stalledList(): string[];
  updateLift(ex: unknown): void;
  checkBest(name: string, beforeBest: number): void;
  stallCard(ex: unknown): string;
  recoveryCard(): string;
  adjAction(a: string, b: { dataset: Record<string, string> }): void;
}

/** The "several stalls → recovery week" lines of prototype `renderStart()`, from the comment to the card's buttons. */
function recoverySnippet(src: string): string {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l === '  // several stalls → recovery week');
  if (from < 0) throw new Error('prototype: no recovery-week step in renderStart');
  const to = lines.findIndex((l, i) => i > from && l.includes("[['adj-deload', 'Start recovery week', true], ['adj-no', 'Not now']]);"));
  if (to < 0 || to - from > 6) throw new Error('prototype: recovery-week card changed shape');
  return lines.slice(from, to + 1).join('\n');
}

/**
 * Runs the prototype's stall, recovery-card and personal-best functions, sliced out of the HTML,
 * against a fake `S`, with `EX_META` passed in. UI calls are stubbed (`whyLink` → '', `sidewaysOf` →
 * none, `saveSoon`, `saveSettings`, `render`); toasts are recorded.
 */
export function loadStalls(meta: ExerciseMetaTable): ProtoStalls {
  const src = prototypeSource();
  const code = [
    'const S = { date:"", lifts:{}, settings:{}, where:"gym", day:{ workout:{} } };',
    'const toasts = [];',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const DEFAULT_STEP = '),
    sliceBlock(src, 'function exInfo(name){', '}'),
    sliceLine(src, 'const noLoad = '),
    sliceLine(src, 'const repWord = '),
    sliceLine(src, 'const adjState = '),
    sliceLine(src, 'const mondayOf = '),
    sliceLine(src, 'const daysBetween = '),
    sliceLine(src, 'const inRange = '),
    sliceBlock(src, 'function sessionScore(sets, type){', '}'),
    sliceBlock(src, 'function stalled(name){', '}'),
    sliceLine(src, 'const stalledList = '),
    sliceBlock(src, 'function adjButtons(', '}'),
    sliceBlock(src, 'function adjCard(', '}'),
    sliceBlock(src, 'function stallCard(ex){', '}'),
    sliceBlock(src, 'function updateLift(ex){', '}'),
    sliceBlock(src, 'function checkBest(name, beforeBest){', '}'),
    sliceBlock(src, 'function adjAction(a, b){', '}'),
    `function recoveryCard(){ const A = adjState(); let h = '';\n${recoverySnippet(src)}\nreturn h; }`,
    'const whereNow = () => S.where, whyLink = () => "", sidewaysOf = () => null;',
    'const saveSoon = () => {}, saveSettings = () => {}, saveDay = () => {}, render = () => {}, toast = m => toasts.push(m);',
    'return { S, toasts, sessionScore, stalled, stalledList, updateLift, checkBest, stallCard, recoveryCard, adjAction };',
  ].join('\n');
  return new Function('EX_META', code)(meta) as ProtoStalls;
}
