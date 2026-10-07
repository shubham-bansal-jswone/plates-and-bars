import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo root, resolved from this file (packages/core/test). */
export const REPO_ROOT = resolve(__dirname, '../../..');

/** Loads docs/spec/golden/<area>.json. Golden files are read-only; never write them from tests. */
export function loadGolden<T>(area: string): T {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'docs/spec/golden', `${area}.json`), 'utf8')) as T;
}

/** Source text of the prototype, for differential tests that run the prototype's own functions. */
export function prototypeSource(): string {
  return readFileSync(resolve(REPO_ROOT, 'docs/prototype/plate-and-bar.html'), 'utf8');
}

/** Returns the text from the first line starting with `start` up to and including the first line after it equal to `end`. */
export function sliceBlock(src: string, start: string, end: string): string {
  const lines = src.split('\n');
  const from = lines.findIndex((l) => l.startsWith(start));
  if (from < 0) throw new Error(`prototype: no line starting with ${start}`);
  const to = lines.findIndex((l, i) => i > from && l === end);
  if (to < 0) throw new Error(`prototype: no closing ${JSON.stringify(end)} after ${start}`);
  return lines.slice(from, to + 1).join('\n');
}

/** Returns the single line starting with `start`. */
export function sliceLine(src: string, start: string): string {
  const line = src.split('\n').find((l) => l.startsWith(start));
  if (line === undefined) throw new Error(`prototype: no line starting with ${start}`);
  return line;
}
