import { has } from '../content/own';

// A TypeScript port of tools/validate/svg-allowlist.mjs (#960): the app cannot import from tools/, so a stored server copy of
// exercise-images is checked here with the same rules. Keep the two in step. The frame is split into tags by a small
// tokenizer that refuses anything it cannot parse, then checked against a fixed element list, a fixed attribute list per
// element, always-double-quoted values and the colour rule. Refused outright: comments, CDATA, processing instructions,
// DOCTYPE, `url(` anywhere, a `:` in any name, entities beyond the basic five, single-quoted or unquoted values, text outside <title>.

export const COLOUR_TOKENS = ['body', 'arm', 'hl', 'eq', 'bg'] as const;
const COLOUR_OK = new RegExp(`^(none|currentColor|var\\(--fig-(${COLOUR_TOKENS.join('|')})\\))$`);
const NUM = /^-?\d+(\.\d+)?$/;
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]*$/;
const TRANSFORM = /^((translate|rotate|scale|matrix|skewX|skewY)\([-0-9.,\s]*\)\s*)+$/;

type Rule = 'colour' | ((v: string) => boolean);
const num = (v: string): boolean => NUM.test(v);
const COMMON: Record<string, Rule> = {
  fill: 'colour', stroke: 'colour', 'stroke-width': num, 'stroke-linecap': (v) => ['butt', 'round', 'square'].includes(v),
  'stroke-linejoin': (v) => ['miter', 'round', 'bevel'].includes(v), opacity: num, 'fill-opacity': num, 'stroke-opacity': num,
  transform: (v) => TRANSFORM.test(v),
};
const geom = (...names: string[]): Record<string, Rule> => Object.fromEntries(names.map((n) => [n, num]));
const ELEMENTS: Record<string, Record<string, Rule>> = {
  svg: { xmlns: (v) => v === 'http://www.w3.org/2000/svg', viewBox: (v) => /^0 0 \d+ \d+$/.test(v) },
  g: { ...COMMON },
  line: { ...COMMON, ...geom('x1', 'y1', 'x2', 'y2') },
  circle: { ...COMMON, ...geom('cx', 'cy', 'r') },
  ellipse: { ...COMMON, ...geom('cx', 'cy', 'rx', 'ry') },
  rect: { ...COMMON, ...geom('x', 'y', 'width', 'height', 'rx', 'ry') },
  path: { ...COMMON, d: (v) => PATH_D.test(v) },
  title: {},
};

const BAD_ENTITY = /&(?!(amp|lt|gt|quot|apos);)/;
const sticky = (re: RegExp): RegExp => new RegExp(re.source, 'y');
const TAG_NAME = sticky(/[A-Za-z][A-Za-z0-9]*/);
const ATTR = sticky(/[ \t\r\n]+([A-Za-z][A-Za-z0-9-]*)="([^"<>]*)"/);
const CLOSE = sticky(/<\/([A-Za-z][A-Za-z0-9]*)[ \t\r\n]*>/);

/** The root's [w, h] when `svg` passes every rule, else null. */
function parse(svg: string): [number, number] | null {
  const stack: string[] = [];
  let root = false;
  let rootClosed = false;
  let viewBox: [number, number] | null = null;
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
      pos = ATTR.lastIndex;
    }
    const end = /^[ \t\r\n]*(\/?)>/.exec(svg.slice(pos));
    if (!end) return null;
    i = pos + end[0].length;
    if (name === 'svg' && !stack.length) {
      const m = /^0 0 (\d+) (\d+)$/.exec(/ viewBox="([^"]*)"/.exec(svg.slice(0, i))?.[1] ?? '');
      viewBox = m ? [Number(m[1]), Number(m[2])] : null;
    }
    if (end[1]) { if (name === 'svg') rootClosed = true; } else stack.push(name);
  }
  return root && !stack.length && rootClosed ? viewBox : null;
}

/** True when `svg` passes the allowlist and its root viewBox is exactly "0 0 w h". */
export function passesAllowlist(svg: string, w: number, h: number): boolean {
  const vb = parse(svg);
  return !!vb && vb[0] === w && vb[1] === h;
}
