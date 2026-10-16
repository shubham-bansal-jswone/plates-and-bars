import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoFeel {
  S: { date: string; lifts: Record<string, unknown> };
  CARDS: Record<string, { f: string; w: [string, string][] }>;
  priorSessions(name: string): number;
  learning(name: string): boolean;
  feelHtml(ex: { name: string; feel?: string | undefined; sets: { done: boolean }[] }, i: number): string;
}

/** Prototype `priorSessions`, `learning` and `feelHtml`, sliced out of the HTML and run against a fake `S` and `CARDS`. */
export function loadFeel(): ProtoFeel {
  const src = prototypeSource();
  const code = [
    'const S = { date:"", lifts:{} };',
    'const CARDS = {};',
    sliceLine(src, 'const esc = '),
    sliceBlock(src, 'function priorSessions(name){', '}'),
    sliceLine(src, 'const learning = '),
    sliceBlock(src, 'function feelHtml(ex, i){', '}'),
    'return { S, CARDS, priorSessions, learning, feelHtml };',
  ].join('\n');
  return new Function(code)() as ProtoFeel;
}
