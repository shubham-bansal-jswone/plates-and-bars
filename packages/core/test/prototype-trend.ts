import { prototypeSource, sliceBlock, sliceLine } from './helpers';

export interface ProtoTrend {
  S: {
    date: string;
    settings: { profile: Record<string, unknown> | null };
    weights: { entries: Record<string, number> };
    measures: { entries: Record<string, Record<string, number>> };
    ui: { scaleJump?: { date: string; kg: number } | null };
    day: { sleep?: string | number };
  };
  shortDate(d: string): string;
  weightChart(): string;
  measuresHtml(): string;
  scaleJumpHtml(): string;
  /** Runs the prototype's `case 'saveW'` with the weight box holding `text`; returns the toast. */
  saveW(text: string): string;
  /** Runs `saveMeasures()` with the tape boxes (`waist`, `neck`, …) holding `boxes`; returns the toast. */
  saveMeasures(boxes: Record<string, string>): string;
  /** Runs the prototype's `enSleep` input step with the box holding `text`; returns whether the day was saved. */
  saveSleep(text: string): boolean;
}

/**
 * Runs the prototype's weight chart, measurements block, scale-jump note and the weight and tape save
 * steps and the sleep input step, sliced out of the HTML, against a fake `S`. `$('#wIn')` and `document.querySelectorAll` are
 * stubbed with the given box text; `toast` records its message.
 */
export function loadTrend(): ProtoTrend {
  const src = prototypeSource();
  const code = [
    "const S = { date:'', settings:{ profile:null }, weights:{ entries:{} }, measures:{ entries:{} }, ui:{}, day:{} };",
    "let toasted = ''; const toast = m => { toasted = m; };",
    'const whyLink = () => "", renderProgress = () => {}, Store = { set: () => {} };',
    sliceLine(src, 'const esc = '),
    sliceLine(src, 'const pad = '),
    sliceLine(src, 'const ymd = '),
    sliceLine(src, 'const parseYmd = '),
    sliceLine(src, 'const addDays = '),
    sliceLine(src, 'const num = '),
    sliceLine(src, 'const r1 = '),
    sliceLine(src, 'const TODAY = '),
    sliceLine(src, 'const shortDate = '),
    sliceLine(src, 'const MEASURES = '),
    sliceBlock(src, 'function measureAt(key, upTo){', '}'),
    sliceBlock(src, 'function navyBF(upTo){', '}'),
    sliceBlock(src, 'function lineChart(points, unit){', '}'),
    sliceBlock(src, 'function measuresHtml(){', '}'),
    sliceBlock(src, 'function weightChart(){', '}'),
    sliceBlock(src, 'function scaleJumpHtml(){', '}'),
    `function saveW(text){ const $ = () => ({ value:text }); toasted = ''; switch('saveW'){\n${sliceBlock(src, "    case 'saveW': {", '    }')}\n} return toasted; }`,
    'function saveMeasuresWith(boxes){ const document = { querySelectorAll: () => Object.entries(boxes).map(([k, v]) => ({ dataset:{ ms:k }, value:v })) }; toasted = "";',
    sliceBlock(src, 'function saveMeasures(){', '}'),
    'saveMeasures(); return toasted; }',
    `function saveSleep(text){ const t = { id:'enSleep', value:text }; let saved = false; const saveDay = () => { saved = true; };\n(() => {\n${sliceLine(src, "  if(t.id === 'enSleep'){")}\n})(); return saved; }`,
    'return { S, shortDate, weightChart, measuresHtml, scaleJumpHtml, saveW, saveMeasures: saveMeasuresWith, saveSleep };',
  ].join('\n');
  return new Function(code)() as ProtoTrend;
}
