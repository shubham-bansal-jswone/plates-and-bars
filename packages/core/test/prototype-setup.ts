import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export type ProtoP = Record<string, unknown>;

export interface ProtoSetup {
  S: { settings: Record<string, unknown> & { profile?: ProtoP | null }; weights: { entries: Record<string, number> }; hadSettings: boolean; tab: string };
  SU: { step: number; p: ProtoP; v: Record<string, string>; unit: string; err: string; from: string };
  validateStep(): string;
  setupResultHtml(): string;
  setupAction(a: string, b: { dataset: Record<string, string> }): void;
  fmt(n: number): string;
  r1(n: number): number;
  SCREEN_Q: string[];
}

/**
 * Runs the prototype's setup functions (`validateStep`, `setupAction`, `setupResultHtml`), sliced out
 * of the HTML, against a fake `S` and `SU`. UI and storage calls are stubbed; `TODAY()` returns `today`.
 */
export function loadSetup(today: string): ProtoSetup {
  const src = prototypeSource();
  const code = [
    "const S = { settings:{}, weights:{ entries:{} }, hadSettings:false, tab:'setup' };",
    "const SU = { step:0, p:null, v:{}, unit:'ft', err:'', from:'food' };",
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const fmt = '),
    sliceLine(src, 'const r1 = '),
    sliceBlock(src, 'const ACTIVITY = {', '};'),
    sliceLine(src, 'const PACE = '),
    sliceLine(src, 'const SEG = '),
    sliceLine(src, 'const TRAIN_NET_MET = '),
    sliceLine(src, 'const bmrOf = '),
    sliceBlock(src, 'function calcTargets(p){', '}'),
    sliceBlock(src, 'const SCREEN_Q = [', '];'),
    sliceLine(src, 'const screenFlag = '),
    sliceBlock(src, 'function setupResultHtml(){', '}'),
    sliceBlock(src, 'function validateStep(){', '}'),
    sliceBlock(src, 'function setupAction(a, b){', '}'),
    'const whyLink = () => "";',
    'const TODAY = () => today;',
    'const Store = { set(){} };',
    'const flush = () => {}, render = () => {}, renderSetup = () => {}, renderFood = () => {}, toast = () => {}, scrollTo = () => {}, startSetup = () => {};',
    'return { S, SU, validateStep, setupResultHtml, setupAction, fmt, r1, SCREEN_Q };',
  ].join('\n');
  return new Function('today', code)(today) as ProtoSetup;
}
