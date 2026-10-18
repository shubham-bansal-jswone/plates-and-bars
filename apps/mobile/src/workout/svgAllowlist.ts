import { has } from '../content/own';

// A TypeScript port of tools/validate/svg-allowlist.mjs (#960): the app cannot import from tools/, so a stored server copy of
// exercise-images is checked here with the same rules. Keep the two in step. The frame is split into tags by a small
// tokenizer that refuses anything it cannot parse, then checked against a fixed element list, a fixed attribute list per
// element, always-double-quoted values and the colour rule. Refused outright: comments, CDATA, processing instructions,
// DOCTYPE, `url(` anywhere, a `:` in any name, entities beyond the basic five, single-quoted or unquoted values, text outside <title>.

export const COLOUR_TOKENS = ['body', 'arm', 'hl', 'eq', 'bg'] as const;
const COLOUR_OK = new RegExp(`^(none|currentColor|var\\(--fig-(${COLOUR_TOKENS.join('|')})\\))$`);
// Numbers are plain decimals of at most 6 integer and 6 fraction digits: no exponent, no Infinity, no 400-digit values.
const NUM = /^-?\d{1,6}(\.\d{1,6})?$/;
const POS = /^\d{1,6}(\.\d{1,6})?$/;
const OPACITY = /^(0(\.\d{1,6})?|1(\.0{1,6})?)$/;

// Path data: a command letter, then numbers (count a multiple of the command's arity; none for Z).
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d{1,6}(?:\.\d{1,6})?)|([ \t\r\n,]+)/y;
function pathOk(d: string): boolean {
  let cmd: string | null = null;
  let count = 0;
  let pos = 0;
  let any = false;
  const closeCmd = (): boolean => {
    if (cmd === null) return true;
    const n = ARITY[cmd.toUpperCase()]!;
    return n === 0 ? count === 0 : count > 0 && count % n === 0;
  };
  while (pos < d.length) {
    PATH_TOKEN.lastIndex = pos;
    const m = PATH_TOKEN.exec(d);
    if (!m) return false;
    pos = PATH_TOKEN.lastIndex;
    if (m[1]) { if (!closeCmd()) return false; cmd = m[1]; count = 0; any = true; }
    else if (m[2]) { if (cmd === null) return false; count++; }
  }
  return any && closeCmd();
}

const TRANSFORM_ARGS: Record<string, number[]> = { translate: [1, 2], rotate: [1, 3], scale: [1, 2], matrix: [6], skewX: [1], skewY: [1] };
function transformOk(v: string): boolean {
  const re = /(translate|rotate|scale|matrix|skewX|skewY)\(([^()]*)\)[ \t\r\n,]*/y;
  let pos = 0;
  if (!v.length) return false;
  while (pos < v.length) {
    re.lastIndex = pos;
    const m = re.exec(v);
    if (!m) return false;
    const args = m[2]!.trim().split(/[ \t\r\n,]+/);
    if (!TRANSFORM_ARGS[m[1]!]!.includes(args.length) || !args.every((a) => NUM.test(a))) return false;
    pos = re.lastIndex;
  }
  return true;
}

type Rule = 'colour' | ((v: string) => boolean);
const num = (v: string): boolean => NUM.test(v);
const pos = (v: string): boolean => POS.test(v);
const opacity = (v: string): boolean => OPACITY.test(v);
const COMMON: Record<string, Rule> = {
  fill: 'colour', stroke: 'colour', 'stroke-width': pos, 'stroke-linecap': (v) => ['butt', 'round', 'square'].includes(v),
  'stroke-linejoin': (v) => ['miter', 'round', 'bevel'].includes(v), opacity, 'fill-opacity': opacity, 'stroke-opacity': opacity, transform: transformOk,
};
const rule = (fn: (v: string) => boolean, ...names: string[]): Record<string, Rule> => Object.fromEntries(names.map((n) => [n, fn]));
const ELEMENTS: Record<string, Record<string, Rule>> = {
  svg: { xmlns: (v) => v === 'http://www.w3.org/2000/svg', viewBox: (v) => /^0 0 \d{1,4} \d{1,4}$/.test(v) },
  g: { ...COMMON },
  line: { ...COMMON, ...rule(num, 'x1', 'y1', 'x2', 'y2') },
  circle: { ...COMMON, ...rule(num, 'cx', 'cy'), r: pos },
  ellipse: { ...COMMON, ...rule(num, 'cx', 'cy'), ...rule(pos, 'rx', 'ry') },
  rect: { ...COMMON, ...rule(num, 'x', 'y'), ...rule(pos, 'width', 'height', 'rx', 'ry') },
  path: { ...COMMON, d: pathOk },
  title: {},
};
// Content model: only svg and g contain elements; title holds text only; the shapes are empty.
const CONTAINERS = ['svg', 'g'];

const BAD_ENTITY = /&(?!(amp|lt|gt|quot|apos);)/;
const sticky = (re: RegExp): RegExp => new RegExp(re.source, 'y');
const TAG_NAME = sticky(/[A-Za-z][A-Za-z0-9]*/);
const ATTR = sticky(/[ \t\r\n]+([A-Za-z][A-Za-z0-9-]*)="([^"<>]*)"/);
const CLOSE = sticky(/<\/([A-Za-z][A-Za-z0-9]*)[ \t\r\n]*>/);

/** The root's [w, h] when `svg` passes every rule, else null. */
function parse(svg: string): [number, number] | null {
  const rootAttrs: Record<string, string> = {};
  const stack: string[] = [];
  let root = false;
  let rootClosed = false;
  let i = 0;
  while (i < svg.length) {
    if (svg[i] !== '<') {
      const j = svg.indexOf('<', i);
      const text = svg.slice(i, j < 0 ? svg.length : j);
      if (stack[stack.length - 1] === 'title') { if (BAD_ENTITY.test(text) || />/.test(text)) return null; }
      else if (/[^ \t\r\n]/.test(text)) return null;
      i += text.length;
      continue;
    }
    if (/^<(!|\?)/.test(svg.slice(i, i + 2))) return null;
    CLOSE.lastIndex = i;
    const close = CLOSE.exec(svg);
    if (close) {
      if (stack.pop() !== close[1]) return null;
      if (!stack.length) rootClosed = true;
      i = CLOSE.lastIndex;
      continue;
    }
    TAG_NAME.lastIndex = i + 1;
    const nm = TAG_NAME.exec(svg);
    if (!nm) return null;
    const name = nm[0];
    if (!has(ELEMENTS, name) || rootClosed) return null;
    if (stack.length && !CONTAINERS.includes(stack[stack.length - 1]!)) return null;
    if (!root) { if (name !== 'svg') return null; root = true; }
    else if (name === 'svg') return null;
    const allowed = ELEMENTS[name]!;
    const seen = new Set<string>();
    let pos = TAG_NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = pos;
      const a = ATTR.exec(svg);
      if (!a) break;
      const [, an, av] = a as unknown as [string, string, string];
      if (seen.has(an) || !has(allowed, an) || /url\s*\(/i.test(av) || BAD_ENTITY.test(av)) return null;
      seen.add(an);
      const rule = allowed[an]!;
      if (rule === 'colour' ? !COLOUR_OK.test(av) : !rule(av)) return null;
      if (name === 'svg') rootAttrs[an] = av;
      pos = ATTR.lastIndex;
    }
    const end = /^[ \t\r\n]*(\/?)>/.exec(svg.slice(pos));
    if (!end) return null;
    i = pos + end[0].length;
    if (end[1]) { if (name === 'svg') rootClosed = true; } else stack.push(name);
  }
  if (!root || stack.length || !rootClosed || rootAttrs.xmlns === undefined) return null;
  const vb = /^0 0 (\d+) (\d+)$/.exec(rootAttrs.viewBox ?? '');
  return vb ? [Number(vb[1]), Number(vb[2])] : null;
}

/** True when `svg` passes the allowlist and its root viewBox is exactly "0 0 w h". */
export function passesAllowlist(svg: string, w: number, h: number): boolean {
  const vb = parse(svg);
  return !!vb && vb[0] === w && vb[1] === h;
}
