import type { OcrBox, OcrLine, OcrResult, OcrWord } from '../../modules/plate-label-scanner/types';
import { OcrError } from '../../modules/plate-label-scanner/errors';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const conf = (v: unknown): number => Math.min(100, Math.max(0, num(v) ?? 0));

function box(v: unknown): OcrBox | undefined {
  const o = (v ?? {}) as Record<string, unknown>;
  const [x, y, width, height] = [num(o.x), num(o.y), num(o.width), num(o.height)];
  return x === null || y === null || width === null || height === null ? undefined : { x, y, width, height };
}

function word(v: unknown): OcrWord | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.text !== 'string' || o.text.trim() === '') return null;
  const b = box(o.box);
  return { text: o.text.trim(), confidence: conf(o.confidence), ...(b ? { box: b } : {}) };
}

/**
 * Checks what an engine returned and shapes it as an [OcrResult]: lines with no text are dropped, confidence is held to 0 to 100,
 * and anything that is not a result at all is an `engine` error rather than a crash further on.
 */
export function toResult(raw: unknown): OcrResult {
  const r = raw as { lines?: unknown; ms?: unknown } | null;
  if (typeof r !== 'object' || r === null || !Array.isArray(r.lines)) throw new OcrError('engine');
  const lines: OcrLine[] = [];
  for (const l of r.lines as unknown[]) {
    const o = (l ?? {}) as Record<string, unknown>;
    if (typeof o.text !== 'string' || o.text.trim() === '') continue;
    const words = Array.isArray(o.words) ? (o.words as unknown[]).map(word).filter((w): w is OcrWord => w !== null) : undefined;
    const b = box(o.box);
    lines.push({ text: o.text.trim(), confidence: conf(o.confidence), ...(words ? { words } : {}), ...(b ? { box: b } : {}) });
  }
  return { lines, ms: Math.max(0, Math.round(num(r.ms) ?? 0)) };
}
