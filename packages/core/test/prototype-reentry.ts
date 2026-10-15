import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoReentry {
  S: { date: string; sessions: { entries: Record<string, unknown> }; settings: { adj?: unknown } };
  reentryCard(): string;
  steadyCard(): string;
  adjAction(a: string, b: { dataset: Record<string, string> }): void;
}

/** Lines of prototype `renderStart()` from the line equal to `first` through the first line ending with `last`. */
function snippet(src: string, first: string, last: string): string {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l === first);
  if (from < 0) throw new Error(`prototype: no line ${first}`);
  const to = lines.findIndex((l, i) => i > from && l.endsWith(last));
  if (to < 0 || to - from > 8) throw new Error(`prototype: step after ${first} changed shape`);
  return lines.slice(from, to + 1).join('\n');
}

/**
 * Runs the "back after a break" and "steady weeks" steps of prototype `renderStart()` and its
 * `adjAction`, sliced out of the HTML, against a fake `S`. UI calls are stubbed.
 */
export function loadReentry(): ProtoReentry {
  const src = prototypeSource();
  const card = (body: string): string => `function () { const A = adjState(); const L = lastSession(S.date); let h = '';\n${body}\nreturn h; }`;
  const code = [
    'const S = { date:"", sessions:{ entries:{} }, settings:{}, day:{ workout:{} } };',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const adjState = '),
    sliceLine(src, 'const mondayOf = '),
    sliceLine(src, 'const daysBetween = '),
    sliceLine(src, 'const sessionDates = '),
    sliceLine(src, 'function lastSession(before){'),
    sliceLine(src, 'const inRange = '),
    sliceBlock(src, 'function adjButtons(', '}'),
    sliceBlock(src, 'function adjCard(', '}'),
    sliceBlock(src, 'function adjAction(a, b){', '}'),
    `const reentryCard = ${card(snippet(src, '  // back after a break', "[['adj-reentry', 'Ease back in', true, long ? '0.3' : '0.15'], ['adj-no', 'Train as normal']]);") + '\n  }')};`,
    `const steadyCard = ${card(snippet(src, '  // optional planned recovery week after 6+ steady weeks without one (evidence is limited, so it\'s optional)', "[['adj-deload', 'Take a lighter week', true], ['adj-no', 'Keep going']]); }"))};`,
    'const whyLink = () => "";',
    'const saveSoon = () => {}, saveSettings = () => {}, saveDay = () => {}, render = () => {}, toast = () => {};',
    'return { S, reentryCard, steadyCard, adjAction };',
  ].join('\n');
  return new Function(code)() as ProtoReentry;
}
