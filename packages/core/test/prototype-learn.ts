import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoLearn {
  S: { settings: { learn?: { start: string; read: string[] }; profile?: { sex: string } } };
  LEARN: string[];
  setToday(d: string): void;
  learnCardHtml(): string;
}

/**
 * Prototype `LEARN`, `daysBetween` and `learnCardHtml`, sliced out of the HTML and run against a fake `S`, a settable
 * `TODAY` and a `KB` whose titles are the card ids.
 */
export function loadLearn(): ProtoLearn {
  const src = prototypeSource();
  const code = [
    'const S = { settings:{} };',
    'let today = "";',
    'const TODAY = () => today;',
    'const KB = new Proxy({}, { get: (_, k) => ({ t: String(k) }) });',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const daysBetween = '),
    sliceLine(src, 'const LEARN = '),
    sliceBlock(src, 'function learnCardHtml(){', '}'),
    'return { S, LEARN, setToday: (d) => { today = d; }, learnCardHtml };',
  ].join('\n');
  return new Function(code)() as ProtoLearn;
}

/** The card `learnCardHtml` offers (its Read button's `data-v`) and its "N of M done" numbers; null when it shows nothing. */
export function protoDaily(html: string): { next: string; readN: number; total: number } | null {
  if (html === '') return null;
  const m = /(\d+) of (\d+) done.*data-v="([a-z]+)"/.exec(html);
  if (!m) throw new Error(`unexpected learn card: ${html}`);
  return { next: m[3] as string, readN: Number(m[1]), total: Number(m[2]) };
}
