import images from '../../../../content/exercise-images.json';
import { contentReader, isArrOf, isObj, isStr, isText, isTrimmedText, perLoad } from '../content/reader';
import { has, isProtoName } from '../content/own';
import type { Palette } from '../theme/tokens';
import { chosenExercises } from './catalog';
import { COLOUR_TOKENS, passesAllowlist } from './svgAllowlist';

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

// The SVG rules are an allowlist (svgAllowlist.ts, a port of tools/validate/svg-allowlist.mjs). Other limits: 1 or 2 frames
// of at most 8192 bytes, w and h up to 1024, the root's viewBox equal to them.
export const FIGURE_MAX_BYTES = 8192;
export const FIGURE_MAX_DIM = 1024;
export const ALT_MAX = 140;
type Token = (typeof COLOUR_TOKENS)[number];
/** Own drawings only, under these licences, until an ADR accepts a third-party source (as tools/validate/exercise-images.mjs). */
const LICENCES: Readonly<Record<string, string>> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= FIGURE_MAX_DIM;
const isHttps = (v: unknown): boolean => isStr(v) && v.length <= 2000 && /^https:\/\/[^\s]+$/.test(v);
const nullOr = (ok: (v: unknown) => boolean) => (v: unknown): boolean => v === null || ok(v);

/** True when `svg` is a drawing the renderer may be given: within the size cap and passing the allowlist with the matching viewBox. */
export function isSafeSvg(svg: unknown, w: number, h: number): svg is string {
  return isStr(svg) && svg.length <= FIGURE_MAX_BYTES && new TextEncoder().encode(svg).length <= FIGURE_MAX_BYTES && passesAllowlist(svg, w, h);
}

const isFrame = (v: unknown): v is FigureFrame =>
  isObj(v) && isStr(v.file) && /^svg\/[a-z0-9]+(-[a-z0-9]+)*\.svg$/.test(v.file) && isInt(v.w) && isInt(v.h) && isSafeSvg(v.svg, v.w, v.h);

const FIELDS = ['frames', 'source', 'source_id', 'licence', 'licence_url', 'author', 'author_url', 'source_url', 'changes', 'alt', 'note'];
const isEntry = (v: unknown): v is FigureEntry =>
  isObj(v) && FIELDS.every((f) => f in v) && Object.keys(v).every((k) => FIELDS.includes(k)) &&
  Array.isArray(v.frames) && v.frames.length >= 1 && v.frames.length <= 2 && isArrOf(v.frames, isFrame) &&
  v.source === 'own_drawing' && isTrimmedText(500)(v.source_id) && isTrimmedText(300)(v.author) &&
  isStr(v.licence) && has(LICENCES, v.licence) && v.licence_url === LICENCES[v.licence] &&
  nullOr(isHttps)(v.author_url) && nullOr(isHttps)(v.source_url) &&
  nullOr(isTrimmedText(500))(v.changes) && nullOr(isTrimmedText(ALT_MAX))(v.alt) && nullOr(isTrimmedText(500))(v.note);

/** Shape and safety of the whole bundle. An empty `images` is valid (nothing is drawn yet). */
export function isFigureBundle(v: unknown): v is FigureBundle {
  if (!isObj(v) || v.schema_version !== 1 || !isObj(v.images)) return false;
  const cards = chosenExercises().cards;
  return Object.entries(v.images).every(([k, e]) => isTrimmedText(200)(k) && !isProtoName(k) && has(cards, k) && isEntry(e));
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

/** Alt text: the entry's `alt` when set, else "<Name>: start and end positions. <setup[0]>" ("held position" for a one-frame figure, an isometric hold) cut at a sentence boundary under ALT_MAX characters. */
export function figureAlt(name: string, entry: Pick<FigureEntry, 'alt' | 'frames'>, setup0: string | undefined): string {
  if (entry.alt) return entry.alt;
  const head = `${name}: ${entry.frames.length > 1 ? 'start and end positions.' : 'held position.'}`;
  const tail = setup0 ? sentencesWithin(setup0, ALT_MAX - head.length - 1) : null;
  return tail ? `${head} ${tail}` : head;
}

/** "CC-BY-4.0" as "CC BY 4.0", "CC0-1.0" as "CC0 1.0". */
export const licenceLabel = (id: string): string => id.replace(/-/g, ' ');

/** Theme colours for the drawing's tokens, light or dark. Colour values stay in theme/tokens.ts; this only picks. */
export const figureColours = (c: Palette): Record<Token | 'current', string> =>
  ({ body: c.ink, arm: c.body, hl: c.fat, eq: c.muted, bg: c.tint, current: c.ink });

/** The frame's SVG text with currentColor and the --fig-* variables replaced by theme colours (no CSS variables on native). */
export function themedSvg(svg: string, c: Palette): string {
  const col = figureColours(c);
  return svg.replace(/var\(--fig-(body|arm|hl|eq|bg)\)/g, (_, t: Token) => col[t]).replace(/currentColor/g, col.current);
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
