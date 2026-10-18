import images from '../../../../content/exercise-images.json';
import { contentReader, isArrOf, isObj, isStr, isText, isTrimmedText, perLoad } from '../content/reader';
import { has, isProtoName } from '../content/own';
import type { Palette } from '../theme/tokens';

/** One drawn frame (content/exercise-images.json): the SVG text is inline, so the bundle travels as one file. */
export interface FigureFrame { file: string; w: number; h: number; svg: string }
/** One exercise's drawing and its licence record (content/exercise-images.json `images`). */
export interface FigureEntry {
  frames: FigureFrame[];
  source: string;
  source_id: string;
  licence: string;
  licence_url: string | null;
  author: string;
  author_url: string | null;
  source_url: string | null;
  changes: string | null;
  alt: string | null;
  note: string | null;
}
export interface FigureBundle { schema_version: number; images: Readonly<Record<string, FigureEntry>> }

// An ALLOWLIST, not a denylist (#960 review): the frame is tokenised and refused unless every piece is on a fixed list.
// Limits: 1 or 2 frames of at most 8192 bytes, w and h up to 1024, the root's viewBox equal to them, and nothing else.
export const FIGURE_MAX_BYTES = 8192;
export const FIGURE_MAX_DIM = 1024;
export const ALT_MAX = 140;
const TOKENS = ['body', 'arm', 'hl', 'eq', 'bg'] as const;
/** The only elements a frame may contain. No script, style, image, use, link, filter, mask, foreignObject, animation or prefixed (`x:`) name. */
const ELEMENTS: ReadonlySet<string> = new Set(['svg', 'g', 'line', 'circle', 'ellipse', 'rect', 'path', 'polyline', 'polygon']);
/** The only attributes (all lower or camel case, none with a colon). `xmlns` and `viewBox` are for the root only. */
const GEOMETRY = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule'];
const COLOUR_ATTRS: ReadonlySet<string> = new Set(['fill', 'stroke']);
const ATTRS: ReadonlySet<string> = new Set([...GEOMETRY, ...COLOUR_ATTRS]);
const COLOUR_OK = new RegExp(`^(none|currentColor|var\\(--fig-(${TOKENS.join('|')})\\))$`);
/** Values hold only these characters: no `:` (so no scheme), no `/`, no quotes, no `&` or `<`. `url` is refused outright. */
const VALUE_OK = /^[A-Za-z0-9 .,()+\-_%]*$/;
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9-]*="[^"]*")*)\s*(\/?)>/y;
const WS = /\s*/y;
const ATTR = /\s+([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g;
const MAX_DEPTH = 8;
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= FIGURE_MAX_DIM;
const isHttps = (v: unknown): boolean => isStr(v) && v.length <= 2000 && /^https:\/\/[^\s]+$/.test(v);
const nullOr = (ok: (v: unknown) => boolean) => (v: unknown): boolean => v === null || ok(v);

/** True when `svg` is a drawing the renderer may be given: bounded, one root with the matching viewBox, allowlisted elements and attributes, theme colours only. */
export function isSafeSvg(svg: unknown, w: number, h: number): svg is string {
  if (!isStr(svg) || svg.length > FIGURE_MAX_BYTES || new TextEncoder().encode(svg).length > FIGURE_MAX_BYTES) return false;
  const stack: string[] = [];
  let pos = 0;
  let rootDone = false;
  while (pos < svg.length) {
    WS.lastIndex = pos; // whitespace between tags is the only text allowed
    WS.exec(svg);
    pos = WS.lastIndex;
    if (pos >= svg.length) break;
    TAG.lastIndex = pos;
    const m = TAG.exec(svg);
    if (!m) return false;
    pos = TAG.lastIndex;
    const [, closing, name, rawAttrs, selfClose] = m as unknown as [string, string, string, string, string];
    if (!ELEMENTS.has(name) || rootDone) return false;
    if (closing) {
      if (rawAttrs || selfClose || stack.pop() !== name) return false;
      if (stack.length === 0) rootDone = true;
      continue;
    }
    const isRoot = stack.length === 0;
    if (isRoot !== (name === 'svg')) return false; // the first element is svg and no other is
    const seen = new Set<string>();
    for (const a of rawAttrs.matchAll(ATTR)) {
      const [, k, v] = a as unknown as [string, string, string];
      if (seen.has(k)) return false;
      seen.add(k);
      if (isRoot) {
        if (!(k === 'xmlns' ? v === 'http://www.w3.org/2000/svg' : k === 'viewBox' && v === `0 0 ${w} ${h}`)) return false;
      } else if (!ATTRS.has(k)) return false;
      else if (COLOUR_ATTRS.has(k) ? !COLOUR_OK.test(v) : !VALUE_OK.test(v) || /url/i.test(v)) return false;
    }
    if (isRoot && !seen.has('viewBox')) return false;
    if (!selfClose) {
      if (stack.length >= MAX_DEPTH) return false;
      stack.push(name);
    } else if (isRoot) rootDone = true;
  }
  return rootDone && stack.length === 0;
}

const isFrame = (v: unknown): v is FigureFrame =>
  isObj(v) && isStr(v.file) && /^svg\/[a-z0-9]+(-[a-z0-9]+)*\.svg$/.test(v.file) && isInt(v.w) && isInt(v.h) && isSafeSvg(v.svg, v.w, v.h);

const isEntry = (v: unknown): v is FigureEntry =>
  isObj(v) && Array.isArray(v.frames) && v.frames.length >= 1 && v.frames.length <= 2 && isArrOf(v.frames, isFrame) &&
  isTrimmedText(200)(v.source) && isTrimmedText(500)(v.source_id) && isTrimmedText(100)(v.licence) && isTrimmedText(300)(v.author) &&
  nullOr(isHttps)(v.licence_url ?? null) && nullOr(isHttps)(v.author_url ?? null) && nullOr(isHttps)(v.source_url ?? null) &&
  nullOr(isTrimmedText(500))(v.changes ?? null) && nullOr(isText(ALT_MAX))(v.alt ?? null) && nullOr(isTrimmedText(500))(v.note ?? null);

/** Shape and safety of the whole bundle. An empty `images` is valid (nothing is drawn yet). */
export function isFigureBundle(v: unknown): v is FigureBundle {
  if (!isObj(v) || v.schema_version !== 1 || !isObj(v.images)) return false;
  return Object.entries(v.images).every(([k, e]) => isTrimmedText(200)(k) && !isProtoName(k) && isEntry(e));
}

const shipped = images as unknown as FigureBundle;

/** The single accept or reject decision for the exercise-images bundle: the Learn block and About both read this. */
export const chosenFigures = contentReader('exercise-images', shipped, isFigureBundle);

/** The drawing for an exercise, or undefined when it has none. */
export function getFigure(name: string): FigureEntry | undefined {
  const all = chosenFigures().images;
  return has(all, name) ? all[name] : undefined;
}

/** Cut `text` at the last sentence end that keeps the whole under `max` characters (null when not even the first sentence fits). */
function sentencesWithin(text: string, max: number): string | null {
  const parts = text.trim().split(/(?<=[.!?])\s+/);
  let out = '';
  for (const p of parts) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return out || null;
}

/** Alt text: the entry's `alt` when set, else "<Name>: start and end positions. <setup[0]>" cut at a sentence boundary under ALT_MAX characters. */
export function figureAlt(name: string, entry: Pick<FigureEntry, 'alt' | 'frames'>, setup0: string | undefined): string {
  if (entry.alt) return entry.alt;
  const head = `${name}: ${entry.frames.length > 1 ? 'start and end positions.' : 'starting position.'}`;
  const tail = setup0 ? sentencesWithin(setup0, ALT_MAX - head.length - 1) : null;
  return tail ? `${head} ${tail}` : head;
}

/** "CC-BY-4.0" as "CC BY 4.0", "CC0-1.0" as "CC0 1.0". */
export const licenceLabel = (id: string): string => id.replace(/-/g, ' ');

/** Theme colours for the drawing's tokens, light or dark. Colour values stay in theme/tokens.ts; this only picks. */
export const figureColours = (c: Palette): Record<(typeof TOKENS)[number] | 'current', string> =>
  ({ body: c.ink, arm: c.body, hl: c.fat, eq: c.outline, bg: c.tint, current: c.ink });

/** The frame's SVG text with currentColor and the --fig-* variables replaced by theme colours (no CSS variables on native). */
export function themedSvg(svg: string, c: Palette): string {
  const col = figureColours(c);
  return svg.replace(/var\(--fig-(body|arm|hl|eq|bg)\)/g, (_, t: (typeof TOKENS)[number]) => col[t]).replace(/currentColor/g, col.current);
}

export interface FigureSource { source: string; licence: string; licence_url: string | null; author: string; author_url: string | null; count: number }

/** About's "Exercise drawings": one row per distinct (source, licence, author) with how many exercises it covers. */
export const getFigureSources = perLoad((): readonly FigureSource[] => {
  const rows = new Map<string, FigureSource>();
  for (const e of Object.values(chosenFigures().images)) {
    const k = [e.source, e.licence, e.author].join('\u0000');
    const prev = rows.get(k);
    if (prev) prev.count++;
    else rows.set(k, { source: e.source, licence: e.licence, licence_url: e.licence_url ?? null, author: e.author, author_url: e.author_url ?? null, count: 1 });
  }
  return [...rows.values()];
});
